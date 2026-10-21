import type { ActivityEvent, ActivityKind, ConnectionState } from "@meshterm/shared";
import { and, desc, eq, lt, lte } from "drizzle-orm";
import { getThresholds } from "../dashboard/dashboard.js";
import type { Db } from "../db/database.js";
import { activity, connections, nodes } from "../db/schema.js";
import type { Hub } from "../events/events.js";

/** The feed keeps a week, and at most this many events per connection. */
export const ACTIVITY_MAX_AGE_MS = 7 * 24 * 3600_000;
export const ACTIVITY_MAX_ROWS = 2_000;
/** At most one "couldn't decrypt" feed entry per sender this often. */
export const UNDECRYPTABLE_EVERY_MS = 10 * 60_000;
/** Prune after this many inserts per connection (pruning on every insert is wasteful). */
const PRUNE_EVERY = 50;
const PREVIEW_CHARS = 80;

export type PowerState = "ok" | "low" | "critical" | "external";

/** Battery level → state; null when unknown. Same bands as the UI (< 20 low, < 10 critical). */
export function powerState(level: number | null): PowerState | null {
  if (level === null) return null;
  if (level > 100) return "external";
  if (level < 10) return "critical";
  if (level < 20) return "low";
  return "ok";
}

export interface ActivityOptions {
  now?: () => number;
  maxRows?: number;
  maxAgeMs?: number;
}

interface NodeMemory {
  lastHeard: number | null;
  power: PowerState | null;
}

/**
 * Turns public events into feed entries, stores them and publishes `activity.new`:
 * messages sent and received; a node new to the DB, or heard again after longer than
 * the stale threshold; a node's power state changing; the link to my node lost and
 * restored. Node and power events count only while connected, so a handshake replaying
 * the node DB isn't news. Ordinary packets and telemetry are never feed items.
 */
export function attachActivity(hub: Hub, db: Db, options: ActivityOptions = {}): () => void {
  const now = options.now ?? Date.now;
  const maxRows = options.maxRows ?? ACTIVITY_MAX_ROWS;
  const maxAgeMs = options.maxAgeMs ?? ACTIVITY_MAX_AGE_MS;

  const states = new Map<number, ConnectionState>();
  const lostAt = new Map<number, number>();
  const memory = new Map<number, Map<number, NodeMemory>>();
  const inserts = new Map<number, number>();
  /** Last "couldn't decrypt" entry per connection and sender. */
  const undecryptable = new Map<string, number>();

  /** What we knew about each node before anything happened (loaded once per connection). */
  const nodesOf = (connectionId: number): Map<number, NodeMemory> => {
    let known = memory.get(connectionId);
    if (!known) {
      known = new Map(
        db
          .select({ num: nodes.num, lastHeard: nodes.lastHeard, battery: nodes.batteryLevel })
          .from(nodes)
          .where(eq(nodes.connectionId, connectionId))
          .all()
          .map((n) => [n.num, { lastHeard: n.lastHeard, power: powerState(n.battery) }]),
      );
      memory.set(connectionId, known);
    }
    return known;
  };
  // Snapshot every existing connection now, before handshakes update the tables.
  for (const { id } of db.select({ id: connections.id }).from(connections).all()) nodesOf(id);

  const myNodeNum = (connectionId: number) =>
    db
      .select({ num: connections.myNodeNum })
      .from(connections)
      .where(eq(connections.id, connectionId))
      .get()?.num ?? null;

  const prune = (connectionId: number, at: number) => {
    db.delete(activity)
      .where(and(eq(activity.connectionId, connectionId), lt(activity.time, at - maxAgeMs)))
      .run();
    const cutoff = db
      .select({ id: activity.id })
      .from(activity)
      .where(eq(activity.connectionId, connectionId))
      .orderBy(desc(activity.id))
      .limit(1)
      .offset(maxRows)
      .get();
    if (cutoff) {
      db.delete(activity)
        .where(and(eq(activity.connectionId, connectionId), lte(activity.id, cutoff.id)))
        .run();
    }
  };

  const record = (
    connectionId: number,
    kind: ActivityKind,
    fields: Partial<Pick<ActivityEvent, "nodeNum" | "messageId" | "value" | "detail">> = {},
    time = now(),
  ) => {
    const row = db
      .insert(activity)
      .values({
        connectionId,
        time,
        kind,
        nodeNum: fields.nodeNum ?? null,
        messageId: fields.messageId ?? null,
        value: fields.value ?? null,
        detail: fields.detail ?? null,
      })
      .returning()
      .get();
    hub.publish("activity.new", { activity: row });
    const count = (inserts.get(connectionId) ?? 0) + 1;
    inserts.set(connectionId, count);
    if (count % PRUNE_EVERY === 0) prune(connectionId, time);
  };

  const offs = [
    hub.subscribe("connection.state", ({ connectionId, state, previous, reason }) => {
      states.set(connectionId, state);
      if (state === "connected") {
        const since = lostAt.get(connectionId);
        if (since !== undefined) {
          lostAt.delete(connectionId);
          record(connectionId, "connection.restored", { value: now() - since });
        }
      } else if (
        previous === "connected" &&
        (state === "reconnecting" || state === "disconnected")
      ) {
        lostAt.set(connectionId, now());
        record(connectionId, "connection.lost", { detail: reason });
      }
    }),

    hub.subscribe("node.upsert", ({ node }) => {
      const known = nodesOf(node.connectionId);
      const prev = known.get(node.num);
      known.set(node.num, { lastHeard: node.lastHeard, power: prev?.power ?? null });
      if (states.get(node.connectionId) !== "connected") return;
      if (node.num === myNodeNum(node.connectionId)) return;
      if (!prev) {
        record(node.connectionId, "node.new", { nodeNum: node.num });
        return;
      }
      const quietMs =
        prev.lastHeard !== null && node.lastHeard !== null ? node.lastHeard - prev.lastHeard : 0;
      if (quietMs >= getThresholds(db).staleMin * 60_000) {
        record(node.connectionId, "node.back", { nodeNum: node.num, value: quietMs });
      }
    }),

    hub.subscribe("telemetry.new", ({ telemetry }) => {
      if (telemetry.kind !== "device") return;
      const level = telemetry.device.batteryLevel;
      const power = powerState(level);
      if (power === null) return;
      const known = nodesOf(telemetry.connectionId);
      const prev = known.get(telemetry.nodeNum);
      known.set(telemetry.nodeNum, { lastHeard: prev?.lastHeard ?? null, power });
      if (states.get(telemetry.connectionId) !== "connected") return;
      if (prev?.power && prev.power !== power) {
        record(telemetry.connectionId, "power.changed", {
          nodeNum: telemetry.nodeNum,
          value: level,
          detail: `${prev.power}→${power}`,
        });
      }
    }),

    hub.subscribe("radio.undecryptable", ({ connectionId, from, to, channel }) => {
      const me = myNodeNum(connectionId);
      // Only what was meant for us: other channels' broadcasts are normal on a busy mesh.
      if (me === null || to !== me || from === me) return;
      if (states.get(connectionId) !== "connected") return;
      const key = `${connectionId}:${from}`;
      const at = now();
      const last = undecryptable.get(key);
      if (last !== undefined && at - last < UNDECRYPTABLE_EVERY_MS) return;
      undecryptable.set(key, at);
      record(connectionId, "message.undecryptable", { nodeNum: from, value: channel });
    }),

    hub.subscribe("message.new", ({ message }) => {
      const inbound = message.direction === "in";
      record(
        message.connectionId,
        inbound ? "message.in" : "message.out",
        {
          nodeNum: inbound ? message.fromNum : message.peer,
          messageId: message.id,
          // Broadcasts: the channel, so the feed can link to it.
          value: message.peer === null ? message.channelIndex : null,
          detail:
            message.text.length > PREVIEW_CHARS
              ? `${message.text.slice(0, PREVIEW_CHARS - 1)}…`
              : message.text,
        },
        message.rxTime,
      );
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** One page of the feed, newest first. */
export function listActivity(
  db: Db,
  connectionId: number,
  options: { before?: number | null; limit: number },
): { events: ActivityEvent[]; nextBefore: number | null } {
  const rows = db
    .select()
    .from(activity)
    .where(
      options.before
        ? and(eq(activity.connectionId, connectionId), lt(activity.id, options.before))
        : eq(activity.connectionId, connectionId),
    )
    .orderBy(desc(activity.id))
    .limit(options.limit + 1)
    .all();
  const events = rows.slice(0, options.limit);
  return {
    events,
    nextBefore: rows.length > options.limit ? (events.at(-1)?.id ?? null) : null,
  };
}
