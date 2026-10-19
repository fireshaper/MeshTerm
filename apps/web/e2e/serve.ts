// The production app for Playwright: FakeNode + the real server serving the built SPA
// (apps/web/dist) and the repo's themes/. Started by playwright.config.ts.
// FakeNode's control API (test-only) lets specs drive it; see control.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeNode, startControlServer } from "@meshterm/fake-node";
import { buildApp } from "@meshterm/server";
import { parseConfig } from "@meshterm/shared";
import { CONTROL_PORT as DEFAULT_CONTROL_PORT, E2E_PORT as DEFAULT_PORT } from "./ports.js";

// Ports come from the environment so playwright.config.ts can run more than one instance.
const E2E_PORT = Number(process.env.E2E_PORT ?? DEFAULT_PORT);
const CONTROL_PORT = Number(process.env.E2E_CONTROL_PORT ?? DEFAULT_CONTROL_PORT);

const node = new FakeNode();
await node.start();
const dataDir = mkdtempSync(join(tmpdir(), "meshterm-e2e-"));
const config = parseConfig({
  MESHTERM_NODE_HOST: "127.0.0.1",
  MESHTERM_NODE_PORT: String(node.port),
  MESHTERM_HTTP_PORT: String(E2E_PORT),
  MESHTERM_DATA_DIR: dataDir,
  MESHTERM_LOG_LEVEL: "warn",
  MESHTERM_BACKOFF_MIN_MS: "200",
  MESHTERM_BACKOFF_MAX_MS: "1000",
  MESHTERM_WEB_DIR: fileURLToPath(new URL("../dist/", import.meta.url)),
  MESHTERM_THEMES_DIR: fileURLToPath(new URL("../../../themes/", import.meta.url)),
});
const app = await buildApp(config);
await app.listen({ host: "127.0.0.1", port: E2E_PORT });
const control = startControlServer(node, CONTROL_PORT);

const stop = () => {
  control.close();
  void app
    .close()
    .then(() => node.stop())
    .finally(() => {
      rmSync(dataDir, { recursive: true, force: true });
      process.exit(0);
    });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
