import { createServer, type IncomingMessage, type Server } from "node:http";
import { auditInbound } from "./audit.js";
import type { AckMode, FakeNode, TextTarget } from "./fake-node.js";

/** Default port of the control API, next to the node's own 4403. */
export const DEFAULT_CONTROL_PORT = 4404;

/** What `GET /inbound` returns: the transmit audit plus a summary of each transmit. */
export interface InboundReport {
  counts: { handshake: number; heartbeat: number; transmit: number; other: number };
  transmits: { to: number; channel: number; portnum: number; text: string | null }[];
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

/**
 * A small HTTP API for driving a FakeNode from another process (tests, the CLI's
 * `inject` command, docker compose). For test setups only: it has no auth.
 *
 * - `POST /inject-text` `{from, target: {channel} | {to}, text}` → `{packetId}`
 * - `POST /reboot` `{downMs}`
 * - `POST /ack-mode` `{mode: "ack" | "nak" | "silent"}`
 * - `POST /clear-inbound`
 * - `GET /inbound` → {@link InboundReport}
 */
export function startControlServer(node: FakeNode, port: number, host = "127.0.0.1"): Server {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://control");
        const body = await readJson(req);
        let result: unknown = { ok: true };
        switch (`${req.method ?? ""} ${url.pathname}`) {
          case "POST /inject-text":
            result = {
              packetId: node.injectText(
                Number(body.from),
                body.target as TextTarget,
                String(body.text),
              ),
            };
            break;
          case "POST /reboot":
            void node.reboot(Number(body.downMs ?? 1000));
            break;
          case "POST /ack-mode":
            node.setAckMode(body.mode as AckMode);
            break;
          case "POST /clear-inbound":
            node.clearInbound();
            break;
          case "GET /inbound":
            result = inboundReport(node);
            break;
          default:
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
      } catch (err) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: String(err) }));
      }
    })();
  });
  server.listen(port, host);
  return server;
}

export function inboundReport(node: FakeNode): InboundReport {
  const audit = auditInbound(node.inbound);
  return {
    counts: audit.counts,
    transmits: audit.transmits.map(({ message }) => {
      const p = message.payloadVariant.case === "packet" ? message.payloadVariant.value : null;
      const data = p?.payloadVariant.case === "decoded" ? p.payloadVariant.value : null;
      return {
        to: p?.to ?? 0,
        channel: p?.channel ?? 0,
        portnum: data?.portnum ?? 0,
        text: data ? new TextDecoder().decode(data.payload) : null,
      };
    }),
  };
}
