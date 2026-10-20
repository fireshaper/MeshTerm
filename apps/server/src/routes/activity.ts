import {
  ActivityPage,
  ConnectionState,
  HistoryWindow,
  NodeHistory,
  TrafficDTO,
  TrafficWindow,
  Uint32,
} from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { listActivity } from "../activity/recorder.js";
import { buildTraffic, nodeHistory } from "../activity/traffic.js";
import { getConnection, getMyNodeNum, getNode } from "../db/repositories.js";
import { HttpError } from "./http-error.js";

const ConnectionParams = z.object({ id: z.coerce.number().int().positive() });

/** A reconnect redoes the full config handshake, so keep people from hammering the node. */
export const RECONNECT_RATE_LIMIT = { max: 6, timeWindow: 60_000 };

/** Activity feed, traffic series, node history and the reconnect action. */
export const activityRoutes: FastifyPluginAsyncZod = (app) => {
  const { db, connections, clock } = app.meshterm;
  const requireConnection = (id: number) => {
    if (!getConnection(db, id)) throw new HttpError(404, "not_found", `connection ${id} not found`);
  };

  app.get(
    "/api/connections/:id/events",
    {
      schema: {
        params: ConnectionParams,
        querystring: z.object({
          before: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: ActivityPage },
      },
    },
    (req) => {
      requireConnection(req.params.id);
      return listActivity(db, req.params.id, {
        before: req.query.before ?? null,
        limit: req.query.limit,
      });
    },
  );

  app.get(
    "/api/connections/:id/traffic",
    {
      schema: {
        params: ConnectionParams,
        querystring: z.object({ window: TrafficWindow.default("24h") }),
        response: { 200: TrafficDTO },
      },
    },
    (req) => {
      const { id } = req.params;
      requireConnection(id);
      return buildTraffic(db, id, getMyNodeNum(db, id), req.query.window, clock.now());
    },
  );

  app.get(
    "/api/connections/:id/nodes/:num/history",
    {
      schema: {
        params: ConnectionParams.extend({ num: z.coerce.number().pipe(Uint32) }),
        querystring: z.object({ window: HistoryWindow.default("24h") }),
        response: { 200: NodeHistory },
      },
    },
    (req) => {
      const { id, num } = req.params;
      requireConnection(id);
      if (!getNode(db, id, num)) throw new HttpError(404, "not_found", `node ${num} not found`);
      return nodeHistory(db, id, num, req.query.window, clock.now());
    },
  );

  app.post(
    "/api/connections/:id/reconnect",
    {
      config: { rateLimit: RECONNECT_RATE_LIMIT },
      schema: {
        params: ConnectionParams,
        response: { 202: z.object({ state: ConnectionState }) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      requireConnection(id);
      const conn = connections.get(id);
      if (!conn) throw new HttpError(409, "not_connected", `connection ${id} is disabled`);
      await conn.reconnect();
      return reply.code(202).send({ state: conn.state });
    },
  );

  return Promise.resolve();
};
