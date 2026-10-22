import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WsGateway } from "../ws/gateway.js";

/** `GET /ws`: hands each upgraded socket to the gateway. */
export function wsRoutes(gateway: WsGateway): FastifyPluginAsyncZod {
  return (app) => {
    app.get("/ws", { websocket: true }, (socket, req) => {
      gateway.attach(socket, req.auth?.id ?? 0);
    });
    return Promise.resolve();
  };
}
