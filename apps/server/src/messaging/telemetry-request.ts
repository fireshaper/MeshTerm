import { Portnums, Telemetry, create, toBinary } from "@meshterm/protocol";
import type { TelemetryKind } from "@meshterm/shared";
import type { Clock, Random } from "../clock.js";
import type { NodeConnection } from "../connection/node-connection.js";
import type { Db } from "../db/database.js";
import { getConnection, getHopLimit, getMyNodeNum, getNode } from "../db/repositories.js";
import type { Hub } from "../events/events.js";
import { silentLogger, type Logger } from "../logger.js";
import { HttpError } from "../routes/http-error.js";
import { DEFAULT_HOP_LIMIT } from "./sender.js";

/** At most one request per node in this long (CR-001 §7.5). */
export const REQUEST_INTERVAL_MS = 5 * 60_000;
/** No answer in this long: tell the user it timed out. */
export const RESPONSE_TIMEOUT_MS = 60_000;
/** Nodes further away aren't asked: the request and its answer cost too much airtime. */
export const MAX_HOPS = 3;

const VARIANTS: Record<
  TelemetryKind,
  "deviceMetrics" | "environmentMetrics" | "powerMetrics" | "airQualityMetrics"
> = {
  device: "deviceMetrics",
  environment: "environmentMetrics",
  power: "powerMetrics",
  air_quality: "airQualityMetrics",
};

export interface TelemetryRequesterDeps {
  db: Db;
  hub: Hub;
  connections: ReadonlyMap<number, NodeConnection>;
  clock: Clock;
  random: Random;
  logger?: Logger;
}

interface Pending {
  kind: TelemetryKind;
  sentAt: number;
  cancel: () => void;
}

/**
 * "Request telemetry" (CR-001 C4): asks one node for a report of one kind. This
 * transmits on the mesh, so it's only ever sent on an admin's request, at most once per
 * node per 5 minutes, and not to nodes more than 3 hops away. The answer arrives as an
 * ordinary telemetry packet; `telemetry.request` tells browsers sent / received / timeout.
 */
export class TelemetryRequester {
  /** `connectionId:num` → when it was last asked. */
  private readonly lastAsked = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  private readonly off: () => void;
  private readonly logger: Logger;

  constructor(private readonly deps: TelemetryRequesterDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.off = deps.hub.subscribe("telemetry.new", ({ telemetry }) => {
      const key = `${telemetry.connectionId}:${telemetry.nodeNum}`;
      const p = this.pending.get(key);
      if (!p || p.kind !== telemetry.kind) return;
      p.cancel();
      this.pending.delete(key);
      this.publish(telemetry.connectionId, telemetry.nodeNum, p.kind, "received");
    });
  }

  close(): void {
    this.off();
    for (const p of this.pending.values()) p.cancel();
    this.pending.clear();
  }

  /**
   * Throws `HttpError`: 404 unknown connection or node, 409 not connected, 400 our own
   * node or too far, 429 asked less than 5 minutes ago.
   */
  request(
    connectionId: number,
    num: number,
    kind: TelemetryKind,
  ): { sentAt: number; timeoutMs: number } {
    const { db, connections, clock } = this.deps;
    if (!getConnection(db, connectionId)) {
      throw new HttpError(404, "not_found", `connection ${connectionId} not found`);
    }
    const conn = connections.get(connectionId);
    const me = getMyNodeNum(db, connectionId);
    if (conn?.state !== "connected" || me === null) {
      throw new HttpError(
        409,
        "not_connected",
        `connection ${connectionId} is ${conn?.state ?? "disabled"}`,
      );
    }
    if (num === me) throw new HttpError(400, "invalid", "that's our own node");
    const node = getNode(db, connectionId, num);
    if (!node) throw new HttpError(404, "not_found", "unknown node");
    if (node.hopsAway !== null && node.hopsAway > MAX_HOPS) {
      throw new HttpError(
        400,
        "too_far",
        `the node is ${node.hopsAway} hops away (at most ${MAX_HOPS})`,
      );
    }
    const key = `${connectionId}:${num}`;
    const now = clock.now();
    const last = this.lastAsked.get(key);
    if (last !== undefined && now - last < REQUEST_INTERVAL_MS) {
      const wait = Math.ceil((REQUEST_INTERVAL_MS - (now - last)) / 60_000);
      throw new HttpError(
        429,
        "rate_limited",
        `asked less than 5 minutes ago: try again in ${wait} min`,
      );
    }

    const payload = toBinary(
      Telemetry.TelemetrySchema,
      create(Telemetry.TelemetrySchema, {
        variant: { case: VARIANTS[kind], value: {} } as never,
      }),
    );
    conn.send({
      payloadVariant: {
        case: "packet",
        value: {
          id: Math.floor(this.deps.random() * 0xffff_ffff) + 1,
          to: num,
          // Like a DM: the node's key (PKI) when it has one, else the primary channel.
          channel: 0,
          hopLimit: getHopLimit(db, connectionId) ?? DEFAULT_HOP_LIMIT,
          payloadVariant: {
            case: "decoded",
            value: { portnum: Portnums.PortNum.TELEMETRY_APP, payload, wantResponse: true },
          },
        },
      },
    });
    this.lastAsked.set(key, now);
    this.pending.get(key)?.cancel();
    const cancel = clock.setTimer(RESPONSE_TIMEOUT_MS, () => {
      if (this.pending.get(key)?.cancel !== cancel) return;
      this.pending.delete(key);
      this.publish(connectionId, num, kind, "timeout");
    });
    this.pending.set(key, { kind, sentAt: now, cancel });
    this.logger.info({ connectionId, num, kind }, "telemetry requested");
    this.publish(connectionId, num, kind, "sent");
    return { sentAt: now, timeoutMs: RESPONSE_TIMEOUT_MS };
  }

  private publish(
    connectionId: number,
    nodeNum: number,
    kind: TelemetryKind,
    state: "sent" | "received" | "timeout",
  ): void {
    this.deps.hub.publish("telemetry.request", { connectionId, nodeNum, kind, state });
  }
}
