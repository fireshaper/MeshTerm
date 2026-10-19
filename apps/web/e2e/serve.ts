// The production app for Playwright: FakeNode + the real server serving the built SPA
// (apps/web/dist) and the repo's themes/. Started by playwright.config.ts.
// A second, test-only HTTP port lets specs drive the FakeNode (see control.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditInbound, FakeNode, type AckMode, type TextTarget } from "@meshterm/fake-node";
import { buildApp } from "@meshterm/server";
import { parseConfig } from "@meshterm/shared";
import { CONTROL_PORT, E2E_PORT } from "./ports.js";

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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

/** Test-only FakeNode control. Never part of the app. */
const control = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://control");
    const body = await readJson(req);
    let result: unknown = { ok: true };
    switch (`${req.method ?? ""} ${url.pathname}`) {
      case "POST /reboot":
        void node.reboot(Number(body.downMs ?? 1000));
        break;
      case "POST /inject-text":
        result = {
          packetId: node.injectText(
            Number(body.from),
            body.target as TextTarget,
            String(body.text),
          ),
        };
        break;
      case "POST /ack-mode":
        node.setAckMode(body.mode as AckMode);
        break;
      case "POST /clear-inbound":
        node.clearInbound();
        break;
      case "GET /inbound": {
        const audit = auditInbound(node.inbound);
        result = {
          counts: audit.counts,
          transmits: audit.transmits.map(({ message }) => {
            const p =
              message.payloadVariant.case === "packet" ? message.payloadVariant.value : null;
            const data = p?.payloadVariant.case === "decoded" ? p.payloadVariant.value : null;
            return {
              to: p?.to,
              channel: p?.channel,
              portnum: data?.portnum,
              text: data ? new TextDecoder().decode(data.payload) : null,
            };
          }),
        };
        break;
      }
      default:
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  })();
});
control.listen(CONTROL_PORT, "127.0.0.1");

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
