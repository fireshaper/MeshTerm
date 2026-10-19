import { ConfigError, parseConfig, type Config } from "@meshterm/shared";
import { buildApp } from "./app.js";

/** Process entry point: config from the environment, listen, close cleanly on signals. */
async function main(): Promise<void> {
  let config: Config;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  let app: Awaited<ReturnType<typeof buildApp>>;
  try {
    app = await buildApp(config);
  } catch (err) {
    console.error(`MeshTerm failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "shutting down");
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await app.listen({ host: "0.0.0.0", port: config.httpPort });
}

void main();
