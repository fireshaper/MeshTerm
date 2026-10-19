import { ConnectionState } from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const HealthResponse = z.object({
  status: z.literal("ok"),
  connections: z.array(z.object({ id: z.number(), name: z.string(), state: ConnectionState })),
});

/** `GET /healthz`: 200 whenever the process is up, with each node connection's state. */
export const healthRoutes: FastifyPluginAsyncZod = (app) => {
  app.get("/healthz", { schema: { response: { 200: HealthResponse } } }, () => ({
    status: "ok" as const,
    connections: [...app.meshterm.connections.values()].map((c) => ({
      id: c.connection.id,
      name: c.connection.name,
      state: c.state,
    })),
  }));
  return Promise.resolve();
};
