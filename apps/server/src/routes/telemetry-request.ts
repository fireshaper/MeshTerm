import { nodeIdFromNum, TelemetryKind } from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { auditRequest } from "../auth/plugin.js";
import type { TelemetryRequester } from "../messaging/telemetry-request.js";

/**
 * `POST /api/connections/:id/nodes/:num/request-telemetry` (CR-001 C4). Admins only;
 * it transmits on the mesh. Every request is in the audit log.
 */
export function telemetryRequestRoutes(requester: TelemetryRequester): FastifyPluginAsyncZod {
  return (app) => {
    const { db, clock } = app.meshterm;
    app.post(
      "/api/connections/:id/nodes/:num/request-telemetry",
      {
        config: { role: "admin" },
        schema: {
          params: z.object({
            id: z.coerce.number().int().positive(),
            num: z.coerce.number().int().positive().max(0xffff_ffff),
          }),
          body: z.object({ kind: TelemetryKind }),
          response: {
            202: z.object({ sentAt: z.number().int(), timeoutMs: z.number().int().positive() }),
          },
        },
      },
      async (req, reply) => {
        const { id, num } = req.params;
        const result = requester.request(id, num, req.body.kind);
        auditRequest(db, clock, req, {
          action: "node.request-telemetry",
          target: nodeIdFromNum(num),
          details: { kind: req.body.kind },
        });
        return reply.code(202).send(result);
      },
    );
    return Promise.resolve();
  };
}
