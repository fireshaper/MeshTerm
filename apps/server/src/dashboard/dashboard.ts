import {
  DashboardThresholds,
  DEFAULT_DASHBOARD_THRESHOLDS,
  nodeIdFromNum,
  type ConnectionState,
  type DashboardDTO,
  type NodeCard,
  type SparkPoint,
} from "@meshterm/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { connections, messages, nodes, settings, telemetry } from "../db/schema.js";

export const SPARK_WINDOW_MS = 24 * 3600 * 1000;
export const SPARK_BUCKET_MS = 30 * 60 * 1000;
export const THRESHOLDS_SETTING = "dashboard.thresholds";

/** Defaults, overridden field by field by the `dashboard.thresholds` setting (JSON). */
export function getThresholds(db: Db): DashboardThresholds {
  const row = db.select().from(settings).where(eq(settings.key, THRESHOLDS_SETTING)).get();
  if (!row) return DEFAULT_DASHBOARD_THRESHOLDS;
  try {
    const stored: unknown = JSON.parse(row.value);
    return DashboardThresholds.parse({ ...DEFAULT_DASHBOARD_THRESHOLDS, ...(stored as object) });
  } catch {
    // A broken setting must not take the dashboard down.
    return DEFAULT_DASHBOARD_THRESHOLDS;
  }
}

export function setThresholds(db: Db, partial: Partial<DashboardThresholds>): void {
  const value = JSON.stringify(DashboardThresholds.partial().parse(partial));
  db.insert(settings)
    .values({ key: THRESHOLDS_SETTING, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
    .run();
}

/**
 * Battery level per node over the last 24 h, averaged into 30-minute buckets (≤ 48
 * points each). One range scan over the covering `telemetry_spark_idx`; the rows come
 * back as plain value arrays and are bucketed here, which is several times faster
 * than GROUP BY (a temp B-tree) plus per-row object mapping for 300 nodes × 48 rows.
 */
export function batterySparks(
  db: Db,
  connectionId: number,
  now: number,
): Map<number, SparkPoint[]> {
  const rows = db.values<[number, number, number]>(
    sql`SELECT ${telemetry.nodeNum}, ${telemetry.time}, ${telemetry.batteryLevel}
        FROM ${telemetry}
        WHERE ${telemetry.connectionId} = ${connectionId}
          AND ${telemetry.kind} = 'device'
          AND ${telemetry.time} >= ${now - SPARK_WINDOW_MS}
          AND ${telemetry.batteryLevel} IS NOT NULL`,
  );
  // node → bucket → [sum, count]
  const sums = new Map<number, Map<number, [number, number]>>();
  for (const [nodeNum, time, level] of rows) {
    let buckets = sums.get(nodeNum);
    if (!buckets) {
      buckets = new Map();
      sums.set(nodeNum, buckets);
    }
    const bucket = Math.floor(time / SPARK_BUCKET_MS);
    const acc = buckets.get(bucket);
    if (acc) {
      acc[0] += level;
      acc[1] += 1;
    } else {
      buckets.set(bucket, [level, 1]);
    }
  }
  const sparks = new Map<number, SparkPoint[]>();
  for (const [nodeNum, buckets] of sums) {
    const points = [...buckets]
      .sort(([a], [b]) => a - b)
      .map(([bucket, [sum, count]]): SparkPoint => [
        bucket * SPARK_BUCKET_MS,
        Math.round(sum / count),
      ]);
    // A window that straddles 49 bucket boundaries keeps the newest 48.
    sparks.set(nodeNum, points.slice(-48));
  }
  return sparks;
}

export interface LiveConnectionInfo {
  state: ConnectionState;
  /** When it entered `state`. */
  stateSince: number;
}

/** The whole dashboard for one connection, from a handful of set-based queries. */
export function buildDashboard(
  db: Db,
  connectionId: number,
  live: LiveConnectionInfo | null,
  now: number,
): DashboardDTO {
  const thresholds = getThresholds(db);
  const connection = db
    .select({ myNodeNum: connections.myNodeNum, lastPacketAt: connections.lastPacketAt })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .get();
  const myNodeNum = connection?.myNodeNum ?? null;
  const sparks = batterySparks(db, connectionId, now);
  const rows = db.select().from(nodes).where(eq(nodes.connectionId, connectionId)).all();

  const cards: NodeCard[] = rows.map((n) => ({
    num: n.num,
    userId: nodeIdFromNum(n.num),
    longName: n.longName,
    shortName: n.shortName,
    role: n.role,
    hwModel: n.hwModel,
    isFavorite: n.favoriteOverride ?? n.isFavorite,
    isSelf: n.num === myNodeNum,
    lastHeard: n.lastHeard,
    hopsAway: n.hopsAway,
    snr: n.snr,
    rssi: n.rssi,
    position:
      n.lat !== null && n.lon !== null && n.positionTime !== null
        ? {
            lat: n.lat,
            lon: n.lon,
            alt: n.altitude,
            precisionBits: n.precisionBits,
            time: n.positionTime,
          }
        : null,
    device:
      n.deviceTime === null
        ? null
        : {
            batteryLevel: n.batteryLevel,
            voltage: n.voltage,
            channelUtil: n.channelUtil,
            airUtilTx: n.airUtilTx,
            uptimeSeconds: n.uptimeSeconds,
            time: n.deviceTime,
          },
    environment:
      n.envTime === null
        ? null
        : {
            temperature: n.temperature,
            humidity: n.humidity,
            pressure: n.pressure,
            time: n.envTime,
          },
    batterySpark: sparks.get(n.num) ?? [],
  }));
  cards.sort(
    (a, b) =>
      Number(b.isSelf) - Number(a.isSelf) ||
      (b.lastHeard ?? -1) - (a.lastHeard ?? -1) ||
      a.num - b.num,
  );

  const self = cards.find((c) => c.isSelf);
  const onlineSince = now - thresholds.onlineMin * 60_000;
  const messages24h =
    db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .where(and(eq(messages.connectionId, connectionId), gte(messages.rxTime, now - 86_400_000)))
      .get()?.n ?? 0;

  return {
    summary: {
      connectionId,
      connectionState: live?.state ?? "disconnected",
      connectedSince: live?.state === "connected" ? live.stateSince : null,
      nodesTotal: cards.length,
      nodesOnline: cards.filter((c) => c.lastHeard !== null && c.lastHeard >= onlineSince).length,
      myNodeNum,
      myBattery: self?.device?.batteryLevel ?? null,
      channelUtil: self?.device?.channelUtil ?? null,
      airUtilTx: self?.device?.airUtilTx ?? null,
      messages24h,
      lastPacketAt: connection?.lastPacketAt ?? null,
    },
    thresholds,
    nodes: cards,
  };
}
