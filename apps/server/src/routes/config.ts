import { Admin } from "@meshterm/protocol";
import {
  ApplyBody,
  ApplyStatusDTO,
  ConfigSnapshotSummary,
  DeviceConfigDTO,
} from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { auditRequest } from "../auth/plugin.js";
import type { AdminClient, AdminVariant } from "../config/admin.js";
import { applyAdminResponse, type ConfigApplier } from "../config/applier.js";
import { listSnapshots, loadSnapshot } from "../config/snapshots.js";
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

/** Device config (CR-002 §8.2): read (secrets masked for viewers), refresh, apply, snapshots. */
export function configRoutes(deps: ConfigRouteDeps): FastifyPluginAsyncZod {
  return (app) => {
    const { db, clock } = app.meshterm;
    const { store, applier, admins } = deps;

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
        config: { role: "admin", rateLimit: CONFIG_RATE_LIMIT },
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
        config: { role: "admin", rateLimit: CONFIG_RATE_LIMIT },
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
