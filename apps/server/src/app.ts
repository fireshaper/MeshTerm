import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { Config, Connection } from "@meshterm/shared";
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import { systemClock, type Clock, type Random } from "./clock.js";
import { NodeConnection } from "./connection/node-connection.js";
import { openDataDirDatabase, type DatabaseHandle, type Db } from "./db/database.js";
import { prepareDatabase } from "./db/init.js";
import { listConnections } from "./db/repositories.js";
import { Hub } from "./events/events.js";
import { attachPersistence } from "./events/persistence.js";
import { wireConnection } from "./events/pipeline.js";
import { MessageSender } from "./messaging/sender.js";
import { apiRoutes } from "./routes/api.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { healthRoutes } from "./routes/health.js";
import { HttpError } from "./routes/http-error.js";
import { tileRoutes } from "./routes/tiles.js";
import { registerSecurityHeaders } from "./security.js";
import { TileCache } from "./tiles/tile-cache.js";
import { isReservedPath, NO_CACHE, staticRoutes } from "./routes/static.js";
import { resolveThemesDir, resolveWebDir } from "./paths.js";
import { sendRoutes } from "./routes/send.js";
import { wsRoutes } from "./routes/ws.js";
import { TcpTransport } from "./transport/tcp-transport.js";
import type { Transport } from "./transport/transport.js";
import { WsGateway } from "./ws/gateway.js";

export type App = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export interface AppDeps {
  /** An open database (e.g. `:memory:` in tests). Default: `<dataDir>/meshterm.db`. Closed by `app.close()`. */
  database?: DatabaseHandle;
  /** Default: TCP to the connection's host and port. */
  createTransport?: (connection: Connection) => Transport;
  clock?: Clock;
  random?: Random;
  /** Pino JSON logs at `config.logLevel` unless false. */
  logger?: boolean;
  /** Built SPA folder; null serves none. Default: `config.webDir` or found next to the server. */
  webDir?: string | null;
  /** Themes folder; null serves none. Default: `config.themesDir` or the repo's themes/. */
  themesDir?: string | null;
  /** Map tile cache. Default: `<dataDir>/tiles`, upstream `config.tileUrl`. */
  tiles?: TileCache;
}

/** What routes need, available as `app.meshterm`. */
export interface Services {
  config: Config;
  db: Db;
  hub: Hub;
  /** One per enabled connection, keyed by connection id. */
  connections: Map<number, NodeConnection>;
  clock: Clock;
  random: Random;
}

declare module "fastify" {
  interface FastifyInstance {
    meshterm: Services;
  }
}

/**
 * Builds the server without listening. Node connections start when the app is
 * ready; `app.close()` stops them and closes the database.
 */
export async function buildApp(config: Config, deps: AppDeps = {}): Promise<App> {
  const clock = deps.clock ?? systemClock;
  const random = deps.random ?? Math.random;
  const app: App = Fastify({
    logger: deps.logger === false ? false : { level: config.logLevel },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(websocket);
  // Off by default; routes opt in with `config.rateLimit`.
  await app.register(rateLimit, { global: false });
  const webDir = deps.webDir !== undefined ? deps.webDir : resolveWebDir(config.webDir);
  const themesDir =
    deps.themesDir !== undefined ? deps.themesDir : resolveThemesDir(config.themesDir);
  // Before any route, so every response carries the headers.
  await registerSecurityHeaders(app, webDir);

  const handle = deps.database ?? openDataDirDatabase(config.dataDir);
  try {
    const seed = prepareDatabase(handle, config, clock.now());
    app.log.info({ seed }, "database ready");
  } catch (err) {
    handle.close();
    throw err;
  }

  const hub = new Hub(app.log);
  attachPersistence(hub, handle.db, app.log, () => clock.now());

  const createTransport =
    deps.createTransport ??
    ((c: Connection) =>
      new TcpTransport({
        host: c.host,
        port: c.port,
        connectTimeoutMs: config.connectTimeoutMs,
        keepAliveMs: config.tcpKeepAliveMs,
      }));

  const connections = new Map<number, NodeConnection>();
  for (const connection of listConnections(handle.db)) {
    if (!connection.enabled) continue;
    const conn = new NodeConnection({
      connection,
      createTransport: () => createTransport(connection),
      timing: {
        configTimeoutMs: config.configTimeoutMs,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        backoffMinMs: config.backoffMinMs,
        backoffMaxMs: config.backoffMaxMs,
      },
      clock,
      random,
    });
    wireConnection(conn, hub, { logger: app.log, now: () => clock.now() });
    conn.on("state", ({ previous, state, reason }) => {
      app.log.info({ connectionId: connection.id, previous, state, reason }, "connection state");
    });
    connections.set(connection.id, conn);
  }

  app.decorate("meshterm", { config, db: handle.db, hub, connections, clock, random });

  app.setErrorHandler<FastifyError>((err, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ error: "bad_request", message: err.message });
    }
    // Deliberate errors (any status) keep their code and message.
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error({ err }, "request failed");
    return reply.code(status).send({
      error:
        status >= 500 ? "internal_error" : status === 429 ? "rate_limited" : err.code || "error",
      message: status >= 500 ? "internal error" : err.message,
    });
  });
  await app.register(staticRoutes({ webDir, themesDir }));
  app.log.info({ webDir, themesDir }, "static files");

  app.setNotFoundHandler((req, reply) => {
    // SPA fallback: client-side routes like /channels/0 get index.html. Never for the
    // API, /ws, /healthz or /themes, and never for paths that look like a file.
    const lastSegment = req.url.split("?")[0]?.split("/").pop() ?? "";
    if (webDir && req.method === "GET" && !isReservedPath(req.url) && !lastSegment.includes(".")) {
      return reply.header("cache-control", NO_CACHE).sendFile("index.html", webDir);
    }
    return reply
      .code(404)
      .send({ error: "not_found", message: `${req.method} ${req.url} not found` });
  });

  await app.register(healthRoutes);
  await app.register(apiRoutes);
  await app.register(dashboardRoutes);
  const tiles =
    deps.tiles ??
    new TileCache({
      dir: join(config.dataDir, "tiles"),
      upstream: config.tileUrl,
      maxBytes: config.tileCacheMb * 1024 * 1024,
    });
  await app.register(tileRoutes(tiles));
  const sender = new MessageSender({
    db: handle.db,
    hub,
    connections,
    clock,
    random,
    ackTimeoutMs: config.ackTimeoutMs,
    logger: app.log,
  });
  await app.register(sendRoutes(sender));
  const gateway = new WsGateway(hub, handle.db, connections, app.log);
  await app.register(wsRoutes(gateway));

  app.addHook("onReady", () => {
    for (const conn of connections.values()) conn.start();
  });
  app.addHook("onClose", async () => {
    gateway.close();
    sender.close();
    await Promise.all([...connections.values()].map((c) => c.stop()));
    handle.close();
  });

  return app;
}
