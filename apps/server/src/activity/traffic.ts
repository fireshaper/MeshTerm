import {
  TRAFFIC_BUCKETS,
  type HistoryWindow,
  type TrafficBucket,
  type NodeHistory,
  type TrafficDTO,
  type TrafficWindow,
} from "@meshterm/shared";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { messages, packetStats, positions, telemetry } from "../db/schema.js";
import { packetRows } from "./network.js";

/**
 * Messages in/out per bucket and my node's average reported channel utilization, for
 * one window. Buckets are aligned to the bucket size; the last one contains `now`.
 * Only stored data: a bucket without reports has `channelUtil: null`.
 */
export function buildTraffic(
  db: Db,
  connectionId: number,
  myNodeNum: number | null,
  window: TrafficWindow,
  now: number,
): TrafficDTO {
  const { spanMs, bucketMs } = TRAFFIC_BUCKETS[window];
  const to = (Math.floor(now / bucketMs) + 1) * bucketMs;
  const from = to - spanMs;
  const count = spanMs / bucketMs;
  const buckets: TrafficBucket[] = Array.from({ length: count }, (_, i) => ({
    time: from + i * bucketMs,
    messagesIn: 0,
    messagesOut: 0,
    channelUtil: null,
    packets: 0,
    packetsByPort: {},
  }));
  const index = (time: number) => Math.floor((time - from) / bucketMs);

  const rows = db.values<[number, string]>(
    sql`SELECT ${messages.rxTime}, ${messages.direction} FROM ${messages}
        WHERE ${messages.connectionId} = ${connectionId}
          AND ${messages.rxTime} >= ${from} AND ${messages.rxTime} < ${to}`,
  );
  for (const [time, direction] of rows) {
    const bucket = buckets[index(time)];
    if (!bucket) continue;
    if (direction === "in") bucket.messagesIn++;
    else bucket.messagesOut++;
  }

  if (myNodeNum !== null) {
    const util = db.values<[number, number]>(
      sql`SELECT ${telemetry.time}, ${telemetry.channelUtil} FROM ${telemetry}
          WHERE ${telemetry.connectionId} = ${connectionId}
            AND ${telemetry.nodeNum} = ${myNodeNum}
            AND ${telemetry.kind} = 'device'
            AND ${telemetry.channelUtil} IS NOT NULL
            AND ${telemetry.time} >= ${from} AND ${telemetry.time} < ${to}`,
    );
    const sums = new Map<number, [number, number]>();
    for (const [time, value] of util) {
      const i = index(time);
      const acc = sums.get(i) ?? [0, 0];
      acc[0] += value;
      acc[1] += 1;
      sums.set(i, acc);
    }
    for (const [i, [sum, n]] of sums) {
      const bucket = buckets[i];
      if (bucket) bucket.channelUtil = Math.round((sum / n) * 100) / 100;
    }
  }

  const portTotals = new Map<string, number>();
  const nodeTotals = new Map<number, number>();
  for (const row of packetRows(db, connectionId, from, to, bucketMs)) {
    const bucket = buckets[row.bucket];
    if (!bucket) continue;
    bucket.packets += row.count;
    bucket.packetsByPort[row.port] = (bucket.packetsByPort[row.port] ?? 0) + row.count;
    portTotals.set(row.port, (portTotals.get(row.port) ?? 0) + row.count);
    nodeTotals.set(row.nodeNum, (nodeTotals.get(row.nodeNum) ?? 0) + row.count);
  }
  const ports = [...portTotals]
    .map(([port, packets]) => ({ port, packets }))
    .sort((a, b) => b.packets - a.packets || a.port.localeCompare(b.port));
  const topNodes = [...nodeTotals]
    .map(([num, packets]) => ({ num, packets }))
    .sort((a, b) => b.packets - a.packets || a.num - b.num)
    .slice(0, 5);

  return { window, bucketMs, from, to, buckets, ports, topNodes };
}

export const HISTORY_SPAN_MS: Record<HistoryWindow, number> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
};
/** Newest points kept per series. */
export const HISTORY_MAX_POINTS = 1_000;

/** One node's stored telemetry and positions in a window, oldest first. */
export function nodeHistory(
  db: Db,
  connectionId: number,
  nodeNum: number,
  window: HistoryWindow,
  now: number,
): NodeHistory {
  const since = now - HISTORY_SPAN_MS[window];
  // Packets heard per hour (24 h) or 6 hours (7 d), every bucket present.
  const heardBucketMs = window === "24h" ? 3600_000 : 6 * 3600_000;
  const heardTo = (Math.floor(now / heardBucketMs) + 1) * heardBucketMs;
  const heardFrom = heardTo - HISTORY_SPAN_MS[window];
  const heard = Array.from({ length: HISTORY_SPAN_MS[window] / heardBucketMs }, (_, i) => ({
    time: heardFrom + i * heardBucketMs,
    packets: 0,
  }));
  const counts = db.values<[number, number]>(
    sql`SELECT ${packetStats.minute}, ${packetStats.count} FROM ${packetStats}
        WHERE ${packetStats.connectionId} = ${connectionId}
          AND ${packetStats.nodeNum} = ${nodeNum}
          AND ${packetStats.minute} >= ${heardFrom} AND ${packetStats.minute} < ${heardTo}`,
  );
  for (const [minute, count] of counts) {
    const bucket = heard[Math.floor((minute - heardFrom) / heardBucketMs)];
    if (bucket) bucket.packets += count;
  }
  const newest = <T extends { time: number }>(rows: T[]) => rows.slice(-HISTORY_MAX_POINTS);
  const ofKind = (kind: "device" | "environment") =>
    and(
      eq(telemetry.connectionId, connectionId),
      eq(telemetry.nodeNum, nodeNum),
      eq(telemetry.kind, kind),
      gte(telemetry.time, since),
    );
  return {
    window,
    device: newest(
      db
        .select({
          time: telemetry.time,
          batteryLevel: telemetry.batteryLevel,
          voltage: telemetry.voltage,
          channelUtil: telemetry.channelUtil,
          airUtilTx: telemetry.airUtilTx,
        })
        .from(telemetry)
        .where(ofKind("device"))
        .orderBy(asc(telemetry.time))
        .all(),
    ),
    environment: newest(
      db
        .select({
          time: telemetry.time,
          temperature: telemetry.temperature,
          humidity: telemetry.humidity,
          pressure: telemetry.pressure,
        })
        .from(telemetry)
        .where(ofKind("environment"))
        .orderBy(asc(telemetry.time))
        .all(),
    ),
    positions: newest(
      db
        .select({
          time: positions.time,
          lat: positions.lat,
          lon: positions.lon,
          altitude: positions.altitude,
        })
        .from(positions)
        .where(
          and(
            eq(positions.connectionId, connectionId),
            eq(positions.nodeNum, nodeNum),
            gte(positions.time, since),
          ),
        )
        .orderBy(asc(positions.time))
        .all(),
    ),
    heard: { bucketMs: heardBucketMs, buckets: heard },
  };
}
