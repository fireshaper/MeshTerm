import {
  bucketFor,
  rateBucketFor,
  SERIES_MAX_POINTS,
  type Series,
  type SeriesDTO,
  type SignalDTO,
  type TelemetryKind,
} from "@meshterm/shared";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { signalLog, telemetry } from "../db/schema.js";
import { rowMetrics } from "./detail.js";

/** An integer literal: bound parameters arrive as REAL, which would make `/` divide exactly. */
const int = (n: number) => sql.raw(String(Math.trunc(n)));

/** Metric names are protobuf field names; anything else is rejected before SQL. */
export const METRIC_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Typed columns standing in for rows stored before `metrics` existed (migration 0009). */
const TYPED: Partial<Record<TelemetryKind, Record<string, SQL>>> = {
  device: {
    battery_level: sql`${telemetry.batteryLevel}`,
    voltage: sql`${telemetry.voltage}`,
    channel_utilization: sql`${telemetry.channelUtil}`,
    air_util_tx: sql`${telemetry.airUtilTx}`,
    uptime_seconds: sql`${telemetry.uptimeSeconds}`,
  },
  environment: {
    temperature: sql`${telemetry.temperature}`,
    relative_humidity: sql`${telemetry.humidity}`,
    barometric_pressure: sql`${telemetry.pressure}`,
  },
};

/** Display order for known metrics; others follow alphabetically. */
const ORDER = [
  "battery_level",
  "voltage",
  "channel_utilization",
  "air_util_tx",
  "uptime_seconds",
  "temperature",
  "relative_humidity",
  "barometric_pressure",
  "gas_resistance",
  "iaq",
  "lux",
];

function metricExpr(kind: TelemetryKind, name: string): SQL {
  const json = sql`json_extract(${telemetry.metrics}, ${`$.${name}`})`;
  const typed = TYPED[kind]?.[name];
  const value = typed ? sql`coalesce(${json}, ${typed})` : json;
  // A battery level above 100 means external power: not a percentage.
  return name === "battery_level" ? sql`CASE WHEN ${value} <= 100 THEN ${value} END` : value;
}

const nodeRange = (
  connectionId: number,
  num: number,
  kind: TelemetryKind,
  from: number,
  to: number,
) =>
  sql`${telemetry.connectionId} = ${connectionId} AND ${telemetry.nodeNum} = ${num}
      AND ${telemetry.kind} = ${kind} AND ${telemetry.time} >= ${from} AND ${telemetry.time} < ${to}`;

/** Metrics reported in the range: JSON keys, plus typed columns of rows without JSON. */
export function metricsInRange(
  db: Db,
  connectionId: number,
  num: number,
  kind: TelemetryKind,
  from: number,
  to: number,
): string[] {
  const where = nodeRange(connectionId, num, kind, from, to);
  const keys = new Set(
    db
      .all<{ key: string }>(
        sql`SELECT DISTINCT j.key AS key FROM ${telemetry}, json_each(${telemetry.metrics}) j
            WHERE ${where} AND ${telemetry.metrics} IS NOT NULL`,
      )
      .map((r) => r.key)
      .filter((k) => METRIC_NAME.test(k)),
  );
  for (const [name, column] of Object.entries(TYPED[kind] ?? {})) {
    if (keys.has(name)) continue;
    const found = db.get<{ n: number } | undefined>(
      sql`SELECT count(*) AS n FROM ${telemetry}
          WHERE ${where} AND ${telemetry.metrics} IS NULL AND ${column} IS NOT NULL`,
    );
    if ((found?.n ?? 0) > 0) keys.add(name);
  }
  return [...keys].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib) || a.localeCompare(b);
  });
}

interface Aggregated {
  bucketMs: number;
  t: number[];
  series: Record<string, Series>;
}

/**
 * Raw rows when the range is short and small enough, else avg/min/max per bucket.
 * `exprs` are SQL expressions over `table`'s rows matching `where`; `time` is its time column.
 */
function aggregate(
  db: Db,
  table: SQL,
  time: SQL,
  where: SQL,
  exprs: Record<string, SQL>,
  spanMs: number,
  bucketParam: number | undefined,
): Aggregated {
  const names = Object.keys(exprs);
  let bucketMs = bucketParam ?? bucketFor(spanMs);
  if (bucketMs === 0) {
    const n =
      db.get<{ n: number } | undefined>(sql`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
        ?.n ?? 0;
    if (n > SERIES_MAX_POINTS) bucketMs = Math.ceil(spanMs / SERIES_MAX_POINTS / 60_000) * 60_000;
  } else if (spanMs / bucketMs > SERIES_MAX_POINTS) {
    bucketMs = Math.ceil(spanMs / SERIES_MAX_POINTS / 60_000) * 60_000;
  }
  const empty = (): Series => (bucketMs === 0 ? { avg: [] } : { avg: [], min: [], max: [] });
  const series: Record<string, Series> = Object.fromEntries(names.map((n) => [n, empty()]));
  const t: number[] = [];
  if (names.length === 0) return { bucketMs, t, series };

  if (bucketMs === 0) {
    const cols = sql.join(
      names.map((n, i) => sql`${exprs[n] ?? sql`NULL`} AS ${sql.raw(`m${i}`)}`),
      sql`, `,
    );
    const rows = db.all<Record<string, number | null>>(
      sql`SELECT ${time} AS t, ${cols} FROM ${table} WHERE ${where} ORDER BY ${time}`,
    );
    for (const row of rows) {
      t.push(row.t as number);
      names.forEach((n, i) => series[n]?.avg.push(row[`m${i}`] ?? null));
    }
    return { bucketMs, t, series };
  }

  const cols = sql.join(
    names.flatMap((n, i) => {
      const e = exprs[n] ?? sql`NULL`;
      return [
        sql`avg(${e}) AS ${sql.raw(`a${i}`)}`,
        sql`min(${e}) AS ${sql.raw(`lo${i}`)}`,
        sql`max(${e}) AS ${sql.raw(`hi${i}`)}`,
      ];
    }),
    sql`, `,
  );
  const rows = db.all<Record<string, number | null>>(
    sql`SELECT (${time} / ${int(bucketMs)}) * ${int(bucketMs)} AS t, ${cols}
        FROM ${table} WHERE ${where} GROUP BY 1 ORDER BY 1`,
  );
  const round = (v: number | null) => (v === null ? null : Math.round(v * 1e4) / 1e4);
  for (const row of rows) {
    t.push(row.t as number);
    names.forEach((n, i) => {
      const s = series[n];
      if (!s) return;
      s.avg.push(round(row[`a${i}`] ?? null));
      s.min?.push(row[`lo${i}`] ?? null);
      s.max?.push(row[`hi${i}`] ?? null);
    });
  }
  return { bucketMs, t, series };
}

/** Index of the entry of `t` (bucket starts, or raw times) that `time` falls in. */
function slot(t: readonly number[], bucketMs: number, time: number): number {
  if (bucketMs > 0) {
    const start = Math.floor(time / bucketMs) * bucketMs;
    return t.indexOf(start);
  }
  return t.indexOf(time);
}

export interface SeriesQuery {
  from: number;
  to: number;
  bucketMs?: number;
}

/**
 * One telemetry kind over a range. Device telemetry also gets two derived series:
 * `powered` (share of samples above 100 %, i.e. on external power) and `reboot`
 * (reboots seen in that sample or bucket: uptime went down).
 */
export function telemetrySeries(
  db: Db,
  connectionId: number,
  num: number,
  kind: TelemetryKind,
  query: SeriesQuery & { metrics?: string[] },
): SeriesDTO {
  const { from, to } = query;
  const names = (query.metrics ?? metricsInRange(db, connectionId, num, kind, from, to)).filter(
    (n) => METRIC_NAME.test(n),
  );
  const exprs: Record<string, SQL> = Object.fromEntries(names.map((n) => [n, metricExpr(kind, n)]));
  if (kind === "device" && names.includes("battery_level")) {
    const raw = sql`coalesce(json_extract(${telemetry.metrics}, '$.battery_level'), ${telemetry.batteryLevel})`;
    exprs.powered = sql`CASE WHEN ${raw} IS NULL THEN NULL WHEN ${raw} > 100 THEN 1.0 ELSE 0.0 END`;
  }
  const where = nodeRange(connectionId, num, kind, from, to);
  const result = aggregate(
    db,
    sql`${telemetry}`,
    sql`${telemetry.time}`,
    where,
    exprs,
    to - from,
    query.bucketMs,
  );

  if (kind === "device" && names.includes("uptime_seconds")) {
    const uptime = metricExpr("device", "uptime_seconds");
    const reboots = db.all<{ time: number }>(
      sql`SELECT time FROM (
            SELECT ${telemetry.time} AS time, ${uptime} AS u,
                   lag(${uptime}) OVER (ORDER BY ${telemetry.time}) AS p
            FROM ${telemetry} WHERE ${where} AND ${uptime} IS NOT NULL
          ) WHERE u < p`,
    );
    const counts: (number | null)[] = result.t.map(() => 0);
    for (const { time } of reboots) {
      const i = slot(result.t, result.bucketMs, time);
      if (i >= 0) counts[i] = (counts[i] ?? 0) + 1;
    }
    result.series.reboot = { avg: counts };
  }
  return { kind, from, to, ...result };
}

/**
 * Signal of packets heard from a node: `snr` and `rssi` only from packets heard
 * directly (0 hops: otherwise they describe the last relay), `hops` from all;
 * plus packet counts per `rate.bucketMs`.
 */
export function signalSeries(
  db: Db,
  connectionId: number,
  num: number,
  query: SeriesQuery,
): SignalDTO {
  const { from, to } = query;
  const where = sql`${signalLog.connectionId} = ${connectionId} AND ${signalLog.nodeNum} = ${num}
      AND ${signalLog.time} >= ${from} AND ${signalLog.time} < ${to}`;
  const direct = (column: SQL) => sql`CASE WHEN ${signalLog.hops} = 0 THEN ${column} END`;
  const result = aggregate(
    db,
    sql`${signalLog}`,
    sql`${signalLog.time}`,
    where,
    {
      snr: direct(sql`${signalLog.snr}`),
      rssi: direct(sql`${signalLog.rssi}`),
      hops: sql`${signalLog.hops}`,
    },
    to - from,
    query.bucketMs,
  );
  const rateMs = rateBucketFor(to - from);
  const counts = db.all<{ t: number; n: number }>(
    sql`SELECT (${signalLog.time} / ${int(rateMs)}) * ${int(rateMs)} AS t, count(*) AS n
        FROM ${signalLog} WHERE ${where} GROUP BY 1 ORDER BY 1`,
  );
  return {
    kind: "signal",
    from,
    to,
    ...result,
    rate: { bucketMs: rateMs, t: counts.map((c) => c.t), packets: counts.map((c) => c.n) },
  };
}

/** CSV-safe cell. */
const cell = (v: string | number | null) => {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Raw telemetry rows of every kind in the range as CSV: `time` (ISO), `kind`, then one
 * column per metric that appears. Oldest first.
 */
export function telemetryCsv(
  db: Db,
  connectionId: number,
  num: number,
  from: number,
  to: number,
): string {
  const rows = db
    .select()
    .from(telemetry)
    .where(
      sql`${telemetry.connectionId} = ${connectionId} AND ${telemetry.nodeNum} = ${num}
          AND ${telemetry.time} >= ${from} AND ${telemetry.time} < ${to}`,
    )
    .orderBy(telemetry.time, telemetry.kind)
    .all();
  const withMetrics = rows.map((r) => ({ r, m: rowMetrics(r) }));
  const columns = [...new Set(withMetrics.flatMap(({ m }) => Object.keys(m)))].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib) || a.localeCompare(b);
  });
  const lines = [["time", "kind", ...columns].join(",")];
  for (const { r, m } of withMetrics) {
    lines.push(
      [new Date(r.time).toISOString(), r.kind, ...columns.map((c) => m[c] ?? null)]
        .map(cell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
