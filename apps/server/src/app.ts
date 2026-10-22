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
import { attachNetworkStats } from "./activity/network.js";
import { attachActivity } from "./activity/recorder.js";
import { systemClock, type Clock, type Random } from "./clock.js";
import { NodeConnection } from "./connection/node-connection.js";
import { openDataDirDatabase, type DatabaseHandle, type Db } from "./db/database.js";
import { prepareDatabase } from "./db/init.js";
import { listConnections, setConnectionHost } from "./db/repositories.js";
import { Hub } from "./events/events.js";
import { attachPersistence } from "./events/persistence.js";
import { wireConnection } from "./events/pipeline.js";
import { MessageSender } from "./messaging/sender.js";
import { activityRoutes } from "./routes/activity.js";
import { nodeDetailRoutes } from "./routes/node-detail.js";
import { apiRoutes } from "./routes/api.js";
import { conversationRoutes } from "./routes/conversations.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { healthRoutes } from "./routes/health.js";
import { HttpError } from "./routes/http-error.js";
import { tileRoutes } from "./routes/tiles.js";
import { authPlugin } from "./auth/plugin.js";
import { audit } from "./auth/store.js";
import { AdminClient } from "./config/admin.js";
import { ConfigApplier } from "./config/applier.js";
import { loadSecretKey } from "./config/snapshots.js";
import { ConfigStore } from "./config/store.js";
import { configRoutes } from "./routes/config.js";
import { maintenanceRoutes } from "./routes/maintenance.js";
import { indexHtmlRenderer, registerSecurityHeaders } from "./security.js";
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
  /** Key that encrypts config snapshots. Default: `MESHTERM_SECRET_KEY` or `<dataDir>/secret.key`. */
  secretKey?: Buffer;
  /** Apply timing overrides (tests). */
  applyTiming?: { noRebootGraceMs?: number; recoveryAfterMs?: number };
  /** Apply/refresh rate limit (default one per 30 s per client); e2e tests relax it. */
  configRateLimit?: { max: number; timeWindow: number };
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
  // After persistence: the feed reads what was stored.
  attachActivity(hub, handle.db, { now: () => clock.now() });
  attachNetworkStats(hub, handle.db);

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
    const conn: NodeConnection = new NodeConnection({
      connection,
      // The current address (it changes when the node moves), or the one to try.
      createTransport: (host) => createTransport({ ...conn.connection, ...(host ? { host } : {}) }),
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
    conn.on("addressChanged", ({ host }) => {
      setConnectionHost(handle.db, connection.id, host);
      app.log.warn({ connectionId: connection.id, host }, "node moved to a new address");
    });
    connections.set(connection.id, conn);
  }

  // Device config (CR-002): the live config from each handshake, the admin link, applies.
  const configStore = new ConfigStore(hub, () => clock.now());
  const admins = new Map<number, AdminClient>();
  for (const [id, conn] of connections) {
    configStore.attach(conn);
    admins.set(id, new AdminClient(conn, { clock, random, logger: app.log }));
  }
  const secretKey = deps.secretKey ?? loadSecretKey(config.secretKey, config.dataDir);
  const applier = new ConfigApplier({
    db: handle.db,
    hub,
    store: configStore,
    connections,
    admins,
    secretKey,
    clock,
    logger: app.log,
    ...deps.applyTiming,
    onFinish: (status) => {
      audit(
        handle.db,
        {
          username: status.by,
          action: "config.apply",
          target: `connection ${status.connectionId}`,
          details: {
            applyId: status.applyId,
            phase: status.phase,
            paths: status.paths,
            mismatches: status.mismatches.map((m) => m.path),
            ...(status.error ? { error: status.error } : {}),
          },
          result: status.phase === "verified" || status.phase === "mismatched" ? "ok" : "failed",
        },
        clock.now(),
      );
    },
  });

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
  await app.register(
    authPlugin({
      db: handle.db,
      clock,
      mode: config.auth,
      sessionDays: config.sessionDays,
      initialAdmin: config.initialAdmin,
    }),
  );
  await app.register(staticRoutes({ webDir, themesDir }));
  app.log.info({ webDir, themesDir }, "static files");

  const renderIndex = indexHtmlRenderer(webDir);
  app.setNotFoundHandler((req, reply) => {
    // SPA fallback: client-side routes like /channels/0 get index.html. Never for the
    // API, /ws, /healthz or /themes, and never for paths that look like a file.
    const lastSegment = req.url.split("?")[0]?.split("/").pop() ?? "";
    if (webDir && req.method === "GET" && !isReservedPath(req.url) && !lastSegment.includes(".")) {
      return renderIndex
        ? reply
            .header("cache-control", NO_CACHE)
            .type("text/html; charset=utf-8")
            .send(renderIndex(reply.raw))
        : reply.header("cache-control", NO_CACHE).sendFile("index.html", webDir);
    }
    return reply
      .code(404)
      .send({ error: "not_found", message: `${req.method} ${req.url} not found` });
  });

  await app.register(healthRoutes);
  await app.register(apiRoutes);
  await app.register(conversationRoutes);
  await app.register(dashboardRoutes);
  await app.register(activityRoutes);
  await app.register(nodeDetailRoutes);
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
  await app.register(
    configRoutes({
      store: configStore,
      applier,
      admins,
      secretKey,
      ...(deps.configRateLimit ? { rateLimit: deps.configRateLimit } : {}),
    }),
  );
  await app.register(
    maintenanceRoutes({
      store: configStore,
      applier,
      admins,
      secretKey,
      ...(deps.configRateLimit ? { rateLimit: deps.configRateLimit } : {}),
    }),
  );
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
