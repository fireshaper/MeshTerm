import { generateKeyPairSync } from "node:crypto";
import { MaintenanceAction } from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { auditRequest } from "../auth/plugin.js";
import { AdminError, type AdminClient, type AdminVariant } from "../config/admin.js";
import { entryJson, type ConfigStore } from "../config/store.js";
import type { ConfigApplier } from "../config/applier.js";
import { saveSnapshot } from "../config/snapshots.js";
import { HttpError } from "./http-error.js";
import { CONFIG_RATE_LIMIT } from "./config.js";

const Params = z.object({ id: z.coerce.number().int().positive() });

/** What each action sends (CR-002 §5.8). Reboot and shutdown after 2 s, so the reply gets out. */
const VARIANTS: Record<MaintenanceAction, AdminVariant> = {
  reboot: { case: "rebootSeconds", value: 2 },
  shutdown: { case: "shutdownSeconds", value: 2 },
  nodedb_reset: { case: "nodedbReset", value: true },
  factory_reset_config: { case: "factoryResetConfig", value: 1 },
  factory_reset_device: { case: "factoryResetDevice", value: 1 },
};

/** These need the node's short name typed as `confirm`. */
const TYPED: ReadonlySet<MaintenanceAction> = new Set([
  "factory_reset_config",
  "factory_reset_device",
]);

export interface MaintenanceRouteDeps {
  store: ConfigStore;
  applier: ConfigApplier;
  admins: ReadonlyMap<number, AdminClient>;
  secretKey: Buffer;
  rateLimit?: { max: number; timeWindow: number };
}

/** A new Curve25519 key pair for the node's PKI (`config.security`), base64. */
export function newKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const raw = (jwk: { d?: string; x?: string }, k: "d" | "x") =>
    Buffer.from(jwk[k] ?? "", "base64url").toString("base64");
  return {
    privateKey: raw(privateKey.export({ format: "jwk" }), "d"),
    publicKey: raw(publicKey.export({ format: "jwk" }), "x"),
  };
}

/** Maintenance actions and key generation (CR-002 §5.8, §7.1). Admins only. */
export function maintenanceRoutes(deps: MaintenanceRouteDeps): FastifyPluginAsyncZod {
  const rateLimit = deps.rateLimit ?? CONFIG_RATE_LIMIT;
  return (app) => {
    const { db, clock } = app.meshterm;

    app.post(
      "/api/config/keypair",
      {
        config: { role: "admin" },
        schema: { response: { 200: z.object({ privateKey: z.string(), publicKey: z.string() }) } },
      },
      () => newKeyPair(),
    );

    app.post(
      "/api/connections/:id/maintenance",
      {
        config: { role: "admin", rateLimit },
        schema: {
          params: Params,
          body: z.object({ action: MaintenanceAction, confirm: z.string().optional() }),
          response: { 200: z.object({ ok: z.literal(true) }) },
        },
      },
      async (req) => {
        const { id } = req.params;
        const { action, confirm } = req.body;
        const entry = deps.store.get(id);
        const admin = deps.admins.get(id);
        if (!entry || !admin)
          throw new HttpError(404, "not_found", "no config for this connection");
        if (deps.applier.running(id)) {
          throw new HttpError(409, "apply_in_progress", "an apply is in progress");
        }
        const shortName = entry.owner?.shortName ?? "";
        if (TYPED.has(action) && (confirm ?? "").trim() !== shortName) {
          throw new HttpError(400, "confirm_required", "type the node's short name to confirm");
        }
        // A fresh snapshot first, whatever the action.
        saveSnapshot(db, deps.secretKey, {
          connectionId: id,
          reason: "pre-maintenance",
          firmware: entry.firmware,
          data: entryJson(entry),
          now: clock.now(),
        });
        try {
          await admin.refreshPasskey();
          await admin.set(VARIANTS[action]);
        } catch (err) {
          // The node may drop the link before its reply: it's doing what it was told.
          if (!(err instanceof AdminError && err.code === "disconnected")) {
            auditRequest(db, clock, req, {
              action: `maintenance.${action}`,
              target: `connection ${id}`,
              result: "failed",
              details: { error: err instanceof Error ? err.message : String(err) },
            });
            throw new HttpError(
              502,
              "node_refused",
              err instanceof Error ? err.message : String(err),
            );
          }
        }
        auditRequest(db, clock, req, {
          action: `maintenance.${action}`,
          target: `connection ${id}`,
        });
        return { ok: true as const };
      },
    );

    return Promise.resolve();
  };
}
