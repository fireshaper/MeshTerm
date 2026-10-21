import { Admin, Channel } from "@meshterm/protocol";
import {
  ApplyBody,
  ApplyStatusDTO,
  ChannelUrlDTO,
  ImportedConfigDTO,
  ParsedChannelUrlDTO,
  ConfigSchemaDTO,
  ConfigSnapshotSummary,
  DeviceConfigDTO,
} from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { auditRequest } from "../auth/plugin.js";
import type { AdminClient, AdminVariant } from "../config/admin.js";
import { applyAdminResponse, type ConfigApplier } from "../config/applier.js";
import { listSnapshots, loadSnapshot } from "../config/snapshots.js";
import { configSchema } from "../config/schema.js";
import { BackupError, backupFileName, exportYaml, importYaml } from "../config/backup.js";
import {
  ChannelUrlError,
  encodeChannelUrl,
  parseChannelUrl,
  qrCode,
  randomPsk,
} from "../config/channel-url.js";
import type { ConfigStore } from "../config/store.js";
import { HttpError } from "./http-error.js";

const Params = z.object({ id: z.coerce.number().int().positive() });

/** One apply or refresh per node every 30 s (CR-002 §7.3). */
export const CONFIG_RATE_LIMIT = { max: 1, timeWindow: 30_000 };

export interface ConfigRouteDeps {
  store: ConfigStore;
  applier: ConfigApplier;
  admins: ReadonlyMap<number, AdminClient>;
  secretKey: Buffer;
  /** Default `CONFIG_RATE_LIMIT`; e2e tests relax it. */
  rateLimit?: { max: number; timeWindow: number };
}

/** Every section a full re-read asks for (`sessionkey` isn't readable config). */
function refreshRequests(): {
  variant: AdminVariant;
  expect:
    "getConfigResponse" | "getModuleConfigResponse" | "getChannelResponse" | "getOwnerResponse";
}[] {
  const configTypes = Object.values(Admin.AdminMessage_ConfigType).filter(
    (v): v is Admin.AdminMessage_ConfigType =>
      typeof v === "number" && v !== Admin.AdminMessage_ConfigType.SESSIONKEY_CONFIG,
  );
  const moduleTypes = Object.values(Admin.AdminMessage_ModuleConfigType).filter(
    (v): v is Admin.AdminMessage_ModuleConfigType => typeof v === "number",
  );
  return [
    { variant: { case: "getOwnerRequest", value: true }, expect: "getOwnerResponse" },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
      variant: { case: "getChannelRequest" as const, value: i },
      expect: "getChannelResponse" as const,
    })),
    ...configTypes.map((t) => ({
      variant: { case: "getConfigRequest" as const, value: t },
      expect: "getConfigResponse" as const,
    })),
    ...moduleTypes.map((t) => ({
      variant: { case: "getModuleConfigRequest" as const, value: t },
      expect: "getModuleConfigResponse" as const,
    })),
  ];
}

const primaryFirst = (c: Channel.Channel) => (c.role === Channel.Channel_Role.PRIMARY ? 0 : 1);

/** Device config (CR-002 §8.2): read (secrets masked for viewers), refresh, apply, snapshots. */
export function configRoutes(deps: ConfigRouteDeps): FastifyPluginAsyncZod {
  const rateLimit = deps.rateLimit ?? CONFIG_RATE_LIMIT;
  return (app) => {
    const { db, clock } = app.meshterm;
    const { store, applier, admins } = deps;

    app.get("/api/config/schema", { schema: { response: { 200: ConfigSchemaDTO } } }, () =>
      configSchema(),
    );

    app.get(
      "/api/config/random-psk",
      {
        config: { role: "admin" },
        schema: {
          querystring: z.object({ bits: z.enum(["128", "256"]).default("256") }),
          response: { 200: z.object({ psk: z.string() }) },
        },
      },
      (req) => ({ psk: randomPsk(req.query.bits === "128" ? 128 : 256) }),
    );

    // The link holds the channel keys: admins only (CR-002 §5.4).
    app.get(
      "/api/connections/:id/channels/url",
      {
        config: { role: "admin" },
        schema: {
          params: Params,
          querystring: z.object({
            indexes: z
              .string()
              .regex(/^[0-7](,[0-7])*$/)
              .optional(),
            lora: z.enum(["true", "false"]).default("true"),
          }),
          response: { 200: ChannelUrlDTO },
        },
      },
      (req) => {
        const entry = store.get(req.params.id);
        if (!entry) throw new HttpError(404, "not_found", "no config for this connection");
        const wanted = req.query.indexes?.split(",").map(Number);
        const channels = [...entry.channels.values()]
          .filter((c) => c.role !== Channel.Channel_Role.DISABLED && c.settings)
          .filter((c) => !wanted || wanted.includes(c.index))
          // The primary first: the receiving app takes the first channel as its primary.
          .sort((a, b) => primaryFirst(a) - primaryFirst(b) || a.index - b.index);
        if (channels.length === 0)
          throw new HttpError(400, "invalid", "no enabled channels chosen");
        const lora = entry.config.get("lora")?.payloadVariant;
        const url = encodeChannelUrl(
          channels.flatMap((c) => (c.settings ? [c.settings] : [])),
          req.query.lora === "true" && lora?.case === "lora" ? lora.value : null,
        );
        // Who exported the keys, never the keys.
        auditRequest(db, clock, req, {
          action: "channels.export",
          target: `connection ${req.params.id}`,
          details: { indexes: channels.map((c) => c.index) },
        });
        return { url, qr: qrCode(url) };
      },
    );

    app.post(
      "/api/connections/:id/channels/url/parse",
      {
        config: { role: "admin" },
        schema: {
          params: Params,
          body: z.object({ url: z.string().max(4096) }),
          response: { 200: ParsedChannelUrlDTO },
        },
      },
      (req) => {
        try {
          return parseChannelUrl(req.body.url);
        } catch (err) {
          if (err instanceof ChannelUrlError) throw new HttpError(400, "invalid", err.message);
          throw err;
        }
      },
    );

    // Backup and restore (CR-002 §5.7). Secrets only when asked for; admins only.
    app.get(
      "/api/connections/:id/config/export",
      {
        config: { role: "admin" },
        schema: {
          params: Params,
          querystring: z.object({ secrets: z.enum(["true", "false"]).default("false") }),
        },
      },
      (req, reply) => {
        const { id } = req.params;
        const entry = store.get(id);
        if (!entry) throw new HttpError(404, "not_found", "no config for this connection");
        const secrets = req.query.secrets === "true";
        const conn = app.meshterm.connections.get(id);
        const position = conn?.model.nodes.get(entry.myNodeNum)?.position;
        const fixed = entry.config.get("position")?.payloadVariant;
        const location =
          fixed?.case === "position" && fixed.value.fixedPosition && position?.latitudeI
            ? {
                lat: position.latitudeI / 1e7,
                lon: (position.longitudeI ?? 0) / 1e7,
                ...(position.altitude ? { alt: position.altitude } : {}),
              }
            : null;
        auditRequest(db, clock, req, {
          action: "config.export",
          target: `connection ${id}`,
          details: { secrets },
        });
        return reply
          .header("content-type", "application/yaml; charset=utf-8")
          .header(
            "content-disposition",
            `attachment; filename="${backupFileName(entry.owner?.shortName ?? "", clock.now())}"`,
          )
          .header("cache-control", "no-store")
          .send(exportYaml(entry, { secrets, location }));
      },
    );

    app.post(
      "/api/connections/:id/config/import",
      {
        config: { role: "admin" },
        bodyLimit: 512 * 1024,
        schema: {
          params: Params,
          body: z.object({ yaml: z.string().max(256 * 1024) }),
          response: { 200: ImportedConfigDTO },
        },
      },
      (req) => {
        try {
          return importYaml(req.body.yaml);
        } catch (err) {
          if (err instanceof BackupError) throw new HttpError(400, "invalid", err.message);
          throw err;
        }
      },
    );

    app.get(
      "/api/connections/:id/config",
      { schema: { params: Params, response: { 200: DeviceConfigDTO } } },
      (req) => {
        const dto = store.dto(req.params.id, { masked: req.auth?.role !== "admin" });
        if (!dto)
          throw new HttpError(
            404,
            "not_found",
            "no config yet: the node hasn't completed a handshake",
          );
        return dto;
      },
    );

    app.post(
      "/api/connections/:id/config/refresh",
      {
        config: { role: "admin", rateLimit },
        schema: { params: Params, response: { 200: DeviceConfigDTO } },
      },
      async (req) => {
        const { id } = req.params;
        const admin = admins.get(id);
        if (!admin || !store.get(id))
          throw new HttpError(404, "not_found", "no config for this connection");
        if (applier.running(id))
          throw new HttpError(409, "apply_in_progress", "an apply is in progress");
        let answered = 0;
        try {
          for (const { variant, expect } of refreshRequests()) {
            try {
              applyAdminResponse(store, id, await admin.get(variant, expect));
              answered++;
            } catch (err) {
              // Sections an older firmware doesn't know simply don't answer.
              if (!(err instanceof Error && "code" in err && err.code === "timeout")) throw err;
            }
          }
        } finally {
          auditRequest(db, clock, req, {
            action: "config.refresh",
            target: `connection ${id}`,
            details: { answered },
          });
        }
        const dto = store.dto(id, { masked: false });
        if (!dto) throw new HttpError(404, "not_found", "no config for this connection");
        return dto;
      },
    );

    app.post(
      "/api/connections/:id/config/apply",
      {
        config: { role: "admin", rateLimit },
        schema: { params: Params, body: ApplyBody, response: { 202: ApplyStatusDTO } },
      },
      (req, reply) => {
        const status = applier.start(req.params.id, req.auth?.username ?? null, req.body);
        auditRequest(db, clock, req, {
          action: "config.apply.start",
          target: `connection ${req.params.id}`,
          details: { applyId: status.applyId, paths: status.paths },
        });
        void reply.code(202);
        return status;
      },
    );

    app.get(
      "/api/connections/:id/config/apply/:applyId",
      {
        schema: {
          params: Params.extend({ applyId: z.uuid() }),
          response: { 200: ApplyStatusDTO },
        },
      },
      (req) => {
        const status = applier.status(req.params.applyId);
        if (status?.connectionId !== req.params.id)
          throw new HttpError(404, "not_found", "no such apply");
        return status;
      },
    );

    app.get(
      "/api/connections/:id/config/snapshots",
      {
        config: { role: "admin" },
        schema: { params: Params, response: { 200: z.array(ConfigSnapshotSummary) } },
      },
      (req) => listSnapshots(db, req.params.id),
    );

    app.get(
      "/api/connections/:id/config/snapshots/:snapId",
      {
        config: { role: "admin" },
        schema: { params: Params.extend({ snapId: z.coerce.number().int().positive() }) },
      },
      (req) => {
        const data = loadSnapshot(db, deps.secretKey, req.params.id, req.params.snapId);
        if (data === null)
          throw new HttpError(404, "not_found", "no such snapshot (or it can't be decrypted)");
        return data;
      },
    );

    return Promise.resolve();
  };
}
