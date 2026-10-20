import {
  keyFingerprint,
  TELEMETRY_KINDS,
  type NodeDetailDTO,
  type TelemetryKind,
  type TelemetryMetrics,
} from "@meshterm/shared";
import { and, eq, sql } from "drizzle-orm";
import { batterySparks, toCard } from "../dashboard/dashboard.js";
import type { Db } from "../db/database.js";
import { connections, messages, nodes, packetStats, telemetry } from "../db/schema.js";

const DAY_MS = 24 * 3600_000;

type TelemetryRow = typeof telemetry.$inferSelect;

/**
 * All fields of a stored report. Rows from before migration 0009 have no `metrics`;
 * their typed columns stand in, under the protobuf names.
 */
export function rowMetrics(row: TelemetryRow): TelemetryMetrics {
  if (row.metrics) return row.metrics;
  const typed: Record<string, number | null> =
    row.kind === "device"
      ? {
          battery_level: row.batteryLevel,
          voltage: row.voltage,
          channel_utilization: row.channelUtil,
          air_util_tx: row.airUtilTx,
          uptime_seconds: row.uptimeSeconds,
        }
      : {
          temperature: row.temperature,
          relative_humidity: row.humidity,
          barometric_pressure: row.pressure,
        };
  return Object.fromEntries(
    Object.entries(typed).filter((e): e is [string, number] => e[1] !== null),
  );
}

/** Null for a node we've never stored. */
export function buildNodeDetail(
  db: Db,
  connectionId: number,
  num: number,
  now: number,
): NodeDetailDTO | null {
  const row = db
    .select()
    .from(nodes)
    .where(and(eq(nodes.connectionId, connectionId), eq(nodes.num, num)))
    .get();
  if (!row) return null;
  const connection = db
    .select({ myNodeNum: connections.myNodeNum, firmware: connections.firmware })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .get();
  const myNodeNum = connection?.myNodeNum ?? null;
  const card = toCard(row, myNodeNum, batterySparks(db, connectionId, now).get(num) ?? []);

  const latestTelemetry: NodeDetailDTO["latestTelemetry"] = {};
  const kinds: TelemetryKind[] = [];
  for (const kind of TELEMETRY_KINDS) {
    const latest = db
      .select()
      .from(telemetry)
      .where(
        and(
          eq(telemetry.connectionId, connectionId),
          eq(telemetry.nodeNum, num),
          eq(telemetry.kind, kind),
        ),
      )
      .orderBy(sql`${telemetry.time} DESC`)
      .limit(1)
      .get();
    if (!latest) continue;
    kinds.push(kind);
    latestTelemetry[kind] = { time: latest.time, metrics: rowMetrics(latest) };
  }

  const since = now - DAY_MS;
  const packets =
    db
      .select({ n: sql<number>`coalesce(sum(${packetStats.count}), 0)` })
      .from(packetStats)
      .where(
        and(
          eq(packetStats.connectionId, connectionId),
          eq(packetStats.nodeNum, num),
          sql`${packetStats.minute} >= ${since}`,
        ),
      )
      .get()?.n ?? 0;
  const messageCount =
    db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(
          eq(messages.connectionId, connectionId),
          eq(messages.fromNum, num),
          eq(messages.direction, "in"),
          sql`${messages.rxTime} >= ${since}`,
        ),
      )
      .get()?.n ?? 0;
  const battery = db
    .select({
      min: sql<number | null>`min(${telemetry.batteryLevel})`,
      max: sql<number | null>`max(${telemetry.batteryLevel})`,
    })
    .from(telemetry)
    .where(
      and(
        eq(telemetry.connectionId, connectionId),
        eq(telemetry.nodeNum, num),
        eq(telemetry.kind, "device"),
        sql`${telemetry.time} >= ${since}`,
        sql`${telemetry.batteryLevel} <= 100`,
      ),
    )
    .get();

  return {
    ...card,
    firstSeen: row.firstSeen,
    firmware: num === myNodeNum ? (connection?.firmware ?? null) : null,
    publicKeyFingerprint: keyFingerprint(row.publicKey),
    publicKey: row.publicKey,
    viaMqtt: row.viaMqtt,
    isIgnored: row.isIgnored,
    latestTelemetry,
    stats24h: {
      packets,
      messages: messageCount,
      batteryMin: battery?.min ?? null,
      batteryMax: battery?.max ?? null,
    },
    telemetryKinds: kinds,
  };
}
