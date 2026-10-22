import { createServer, type IncomingMessage, type Server } from "node:http";
import { auditInbound } from "./audit.js";
import type { AckMode, FakeNode, TelemetryInit, TextTarget } from "./fake-node.js";

/** Default port of the control API, next to the node's own 4403. */
export const DEFAULT_CONTROL_PORT = 4404;

/** What `GET /inbound` returns: the transmit audit plus a summary of each transmit. */
export interface InboundReport {
  counts: { handshake: number; heartbeat: number; transmit: number; admin: number; other: number };
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
 * - `POST /inject-text` `{from, target: {channel} | {to}, text, options?}` → `{packetId}`
 *   (`options`: `InjectTextOptions`, e.g. `{pkiEncrypted, replyId, emoji, packetId}`)
 * - `POST /inject-telemetry` `{from, device: {batteryLevel?, voltage?, channelUtilization?, airUtilTx?, uptimeSeconds?}}`
 *   or `{from, environment: {temperature?, relativeHumidity?, barometricPressure?}}` → `{packetId}`
 * - `POST /inject-position` `{from, lat, lon, altitude?, precisionBits?}` → `{packetId}`
 * - `POST /inject-neighbors` `{from, neighbors: [{nodeId, snr}]}` → `{packetId}`
 * - `POST /reboot` `{downMs}`
 * - `POST /inject-history` `{days?}` → `{packets}`: backdated telemetry (`historyPackets`)
 * - `POST /ack-mode` `{mode: "ack" | "nak" | "silent", reason?}` (`reason`: NAK `Routing.Error` name)
 * - `POST /admin-options` `{rebootOnCommitMs?, clampTxPowerTo?}`: admin module behaviour (CR-002)
 * - `GET /admin-log` → `{log}`: the admin message cases the node received, in order
 * - `POST /telemetry-responses` `{enabled}`: whether nodes answer telemetry requests
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
                body.options ?? {},
              ),
            };
            break;
          case "POST /inject-telemetry":
            result = { packetId: node.injectTelemetry(Number(body.from), telemetryFrom(body)) };
            break;
          case "POST /inject-neighbors":
            result = {
              packetId: node.injectNeighborInfo(
                Number(body.from),
                (Array.isArray(body.neighbors) ? (body.neighbors as unknown[]) : []).map((n) => {
                  const { nodeId, snr } = n as { nodeId?: unknown; snr?: unknown };
                  return { nodeId: Number(nodeId), snr: Number(snr ?? 0) };
                }),
              ),
            };
            break;
          case "POST /inject-position":
            result = {
              packetId: node.injectPosition(Number(body.from), {
                latitudeI: Math.round(Number(body.lat) * 1e7),
                longitudeI: Math.round(Number(body.lon) * 1e7),
                ...(body.altitude === undefined ? {} : { altitude: Number(body.altitude) }),
                ...(body.precisionBits === undefined
                  ? {}
                  : { precisionBits: Number(body.precisionBits) }),
              }),
            };
            break;
          case "POST /reboot":
            void node.reboot(Number(body.downMs ?? 1000));
            break;
          case "POST /inject-history":
            result = { packets: node.injectHistory(Number(body.days ?? 30)) };
            break;
          case "POST /ack-mode":
            node.setAckMode(
              body.mode as AckMode,
              0,
              typeof body.reason === "string" ? body.reason : undefined,
            );
            break;
          case "POST /admin-options": {
            const clampTo = body.clampTxPowerTo;
            node.setAdminOptions({
              ...(body.rebootOnCommitMs === undefined
                ? {}
                : { rebootOnCommitMs: Number(body.rebootOnCommitMs) }),
              ...(clampTo === undefined
                ? {}
                : {
                    clamp:
                      clampTo === null
                        ? null
                        : (c) =>
                            c.payloadVariant.case === "lora" &&
                            c.payloadVariant.value.txPower > Number(clampTo)
                              ? {
                                  ...c,
                                  payloadVariant: {
                                    case: "lora",
                                    value: { ...c.payloadVariant.value, txPower: Number(clampTo) },
                                  },
                                }
                              : c,
                  }),
            });
            break;
          }
          case "GET /admin-log":
            result = { log: node.admin.log };
            break;
          case "POST /telemetry-responses":
            node.setTelemetryResponses(body.enabled !== false);
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

function telemetryFrom(body: Record<string, unknown>): TelemetryInit {
  if (body.environment && typeof body.environment === "object") {
    return { variant: { case: "environmentMetrics", value: body.environment } };
  }
  if (body.device && typeof body.device === "object") {
    return { variant: { case: "deviceMetrics", value: body.device } };
  }
  throw new Error("inject-telemetry needs device or environment");
}

export function inboundReport(node: FakeNode): InboundReport {
  const audit = auditInbound(node.inbound, node.myNodeNum);
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
