import { DashboardDTO, MeshNode, Uint32 } from "@meshterm/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { buildDashboard } from "../dashboard/dashboard.js";
import { getConnection, getNode } from "../db/repositories.js";
import { nodes } from "../db/schema.js";
import { HttpError } from "./http-error.js";

const ConnectionParams = z.object({ id: z.coerce.number().int().positive() });

/** `GET /api/connections/:id/dashboard` and the favorite toggle. */
export const dashboardRoutes: FastifyPluginAsyncZod = (app) => {
  const { db, connections, hub, clock } = app.meshterm;
  const requireConnection = (id: number) => {
    if (!getConnection(db, id)) throw new HttpError(404, "not_found", `connection ${id} not found`);
  };

  app.get(
    "/api/connections/:id/dashboard",
    { schema: { params: ConnectionParams, response: { 200: DashboardDTO } } },
    (req) => {
      const { id } = req.params;
      requireConnection(id);
      const conn = connections.get(id);
      const live = conn ? { state: conn.state, stateSince: conn.stateSince } : null;
      return buildDashboard(db, id, live, clock.now());
    },
  );

  app.put(
    "/api/connections/:id/nodes/:num/favorite",
    {
      config: { role: "admin" },
      schema: {
        params: ConnectionParams.extend({ num: z.coerce.number().pipe(Uint32) }),
        body: z.object({ favorite: z.boolean() }),
        response: { 200: z.object({ node: MeshNode }) },
      },
    },
    (req) => {
      const { id, num } = req.params;
      requireConnection(id);
      // Local only: syncing favorites to the device is an admin action (not built yet).
      const { changes } = db
        .update(nodes)
        .set({ favoriteOverride: req.body.favorite })
        .where(and(eq(nodes.connectionId, id), eq(nodes.num, num)))
        .run();
      const node = changes > 0 ? getNode(db, id, num) : null;
      if (!node) throw new HttpError(404, "not_found", `node ${num} not found`);
      hub.publish("node.upsert", { node });
      return { node };
    },
  );

  return Promise.resolve();
};
