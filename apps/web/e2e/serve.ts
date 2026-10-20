// The production app for Playwright: FakeNode + the real server serving the built SPA
// (apps/web/dist) and the repo's themes/. Started by playwright.config.ts.
// FakeNode's control API (test-only) lets specs drive it; see control.ts. Map tiles
// come from an in-process FakeTileServer, so no test ever reaches a real tile server.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeNode, FakeTileServer, startControlServer, until } from "@meshterm/fake-node";
import { buildApp } from "@meshterm/server";
import { parseConfig } from "@meshterm/shared";
import { CONTROL_PORT as DEFAULT_CONTROL_PORT, E2E_PORT as DEFAULT_PORT } from "./ports.js";

// Ports come from the environment so playwright.config.ts can run more than one instance.
const E2E_PORT = Number(process.env.E2E_PORT ?? DEFAULT_PORT);
const CONTROL_PORT = Number(process.env.E2E_CONTROL_PORT ?? DEFAULT_CONTROL_PORT);
const SCENARIO = process.env.E2E_SCENARIO ?? "default";

const node = new FakeNode({ scenario: SCENARIO });
await node.start();
const tiles = new FakeTileServer();
await tiles.start();
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
  MESHTERM_TILE_URL: tiles.urlTemplate,
  MESHTERM_THEMES_DIR: fileURLToPath(new URL("../../../themes/", import.meta.url)),
});
const app = await buildApp(config);
const historyDays = Number(process.env.E2E_HISTORY_DAYS ?? 0);
if (historyDays > 0) {
  // Backdated telemetry (FakeNode historyPackets), stored before /healthz answers.
  // Connections start once the app is ready.
  await app.ready();
  await until(() => app.meshterm.connections.get(1)?.state === "connected", 30_000);
  let stored = 0;
  const off = app.meshterm.hub.subscribe("telemetry.new", () => {
    stored++;
  });
  const sent = node.injectHistory(historyDays);
  await until(() => stored >= sent, 110_000);
  off();
}
await app.listen({ host: "127.0.0.1", port: E2E_PORT });
const control = startControlServer(node, CONTROL_PORT);

const stop = () => {
  control.close();
  void app
    .close()
    .then(() => Promise.all([node.stop(), tiles.stop()]))
    .finally(() => {
      rmSync(dataDir, { recursive: true, force: true });
      process.exit(0);
    });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
