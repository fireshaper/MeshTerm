import {
  TRAFFIC_BUCKETS,
  type HistoryWindow,
  type NodeHistory,
  type TrafficDTO,
  type TrafficWindow,
} from "@meshterm/shared";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { messages, positions, telemetry } from "../db/schema.js";

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
  const buckets = Array.from({ length: count }, (_, i) => ({
    time: from + i * bucketMs,
    messagesIn: 0,
    messagesOut: 0,
    channelUtil: null as number | null,
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

  return { window, bucketMs, from, to, buckets };
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
  };
}
