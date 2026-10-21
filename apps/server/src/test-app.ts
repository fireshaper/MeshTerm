import { FakeNode, until } from "@meshterm/fake-node";
import { parseConfig } from "@meshterm/shared";
import { buildApp, type App, type AppDeps } from "./app.js";
import { openDatabase } from "./db/database.js";

export interface TestApp {
  app: App;
  node: FakeNode;
  /** Id of the env-seeded connection (1 on a fresh database). */
  connectionId: number;
  close(): Promise<void>;
}

/**
 * The full app against a fresh FakeNode, with an in-memory database and short
 * timings, already `connected`. `env` overrides any MESHTERM_* variable.
 */
export async function startTestApp(
  options: {
    env?: Record<string, string>;
    deps?: AppDeps;
    node?: FakeNode;
    waitConnected?: boolean;
  } = {},
): Promise<TestApp> {
  const node = options.node ?? new FakeNode();
  if (node.port === 0) await node.start();
  const config = parseConfig({
    MESHTERM_NODE_HOST: "127.0.0.1",
    MESHTERM_NODE_PORT: String(node.port),
    MESHTERM_DATA_DIR: "unused-in-tests",
    MESHTERM_CONNECT_TIMEOUT_MS: "1000",
    MESHTERM_CONFIG_TIMEOUT_MS: "2000",
    MESHTERM_BACKOFF_MIN_MS: "100",
    MESHTERM_BACKOFF_MAX_MS: "400",
    // Most tests aren't about accounts; auth tests set "local".
    MESHTERM_AUTH: "none",
    ...options.env,
  });
  const app = await buildApp(config, {
    database: openDatabase(":memory:"),
    logger: false,
    webDir: null,
    themesDir: null,
    secretKey: Buffer.alloc(32, 7),
    ...options.deps,
  });
  await app.ready();
  const connectionId = 1;
  if (options.waitConnected !== false) {
    await until(() => app.meshterm.connections.get(connectionId)?.state === "connected", 5_000);
  }
  return {
    app,
    node,
    connectionId,
    close: async () => {
      await app.close();
      await node.stop();
    },
  };
}
