import type { SeriesDTO, TelemetryReport } from "@meshterm/shared";

/** Ranges the picker offers; `custom` carries its own bounds. */
export const RANGE_PRESETS = ["1h", "24h", "7d", "30d"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type NodeRange = { preset: RangePreset } | { preset: "custom"; from: number; to: number };

const HOUR = 3600_000;
export const PRESET_MS: Record<RangePreset, number> = {
  "1h": HOUR,
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
  "30d": 30 * 24 * HOUR,
};
export const PRESET_LABELS: Record<RangePreset, string> = {
  "1h": "1 h",
  "24h": "24 h",
  "7d": "7 d",
  "30d": "30 d",
};

/** The range's bounds now (presets end at `now`). */
export function rangeBounds(range: NodeRange, now: number): { from: number; to: number } {
  return range.preset === "custom"
    ? { from: range.from, to: range.to }
    : { from: now - PRESET_MS[range.preset], to: now };
}

/** A stable cache key: presets slide with time, custom ranges are fixed. */
export const rangeKey = (range: NodeRange) =>
  range.preset === "custom" ? `custom:${range.from}-${range.to}` : range.preset;

export const RANGE_KEY = "meshterm.nodeRange";

export function readRange(): NodeRange {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RANGE_KEY) ?? "null");
    if (raw && typeof raw === "object" && "preset" in raw) {
      const r = raw as Record<string, unknown>;
      if (RANGE_PRESETS.includes(r.preset as RangePreset))
        return { preset: r.preset as RangePreset };
      if (
        r.preset === "custom" &&
        typeof r.from === "number" &&
        typeof r.to === "number" &&
        r.from < r.to
      ) {
        return { preset: "custom", from: r.from, to: r.to };
      }
    }
  } catch {
    // Unreadable or blocked: the default.
  }
  return { preset: "24h" };
}

export function writeRange(range: NodeRange): void {
  try {
    localStorage.setItem(RANGE_KEY, JSON.stringify(range));
  } catch {
    // Not remembered.
  }
}

/** Typical spacing of a node's samples: the median gap between consecutive times. */
export function medianInterval(t: readonly number[]): number | null {
  if (t.length < 2) return null;
  const gaps = t
    .slice(1)
    .map((x, i) => x - (t[i] ?? x))
    .sort((a, b) => a - b);
  // The lower middle for an even count: one long gap must not set the typical spacing.
  return gaps[Math.floor((gaps.length - 1) / 2)] ?? null;
}

/**
 * uPlot data (x first) for some series of a response, with a null row inserted wherever
 * the gap between samples exceeds 3× the typical interval (or the bucket), so lines
 * break there instead of bridging hours without data (CR-001 §5.4).
 */
export function toChartData(
  dto: Pick<SeriesDTO, "t" | "bucketMs">,
  columns: readonly (readonly (number | null)[] | undefined)[],
): (number | null)[][] {
  const typical = Math.max(dto.bucketMs, medianInterval(dto.t) ?? 0);
  const limit = typical > 0 ? typical * 3 : Infinity;
  const x: number[] = [];
  const ys: (number | null)[][] = columns.map(() => []);
  dto.t.forEach((time, i) => {
    const prev = dto.t[i - 1];
    if (prev !== undefined && time - prev > limit) {
      x.push(prev + typical);
      ys.forEach((y) => y.push(null));
    }
    x.push(time);
    columns.forEach((col, c) => ys[c]?.push(col?.[i] ?? null));
  });
  return [x, ...ys];
}

export interface Summary {
  min: number | null;
  max: number | null;
  latest: number | null;
}

/** Min, max and latest of a series (min/max from the band when bucketed). */
export function summarize(dto: SeriesDTO, name: string): Summary {
  const s = dto.series[name];
  if (!s) return { min: null, max: null, latest: null };
  const values = (arr: readonly (number | null)[] | undefined) =>
    (arr ?? []).filter((v): v is number => v !== null);
  const lows = values(s.min ?? s.avg);
  const highs = values(s.max ?? s.avg);
  const avg = values(s.avg);
  return {
    min: lows.length ? Math.min(...lows) : null,
    max: highs.length ? Math.max(...highs) : null,
    latest: avg.at(-1) ?? null,
  };
}

/** Whether any series of the response has a value. */
export const hasData = (dto: SeriesDTO, names: readonly string[]) =>
  names.some((n) => dto.series[n]?.avg.some((v) => v !== null));

/** A device report's values under the protobuf names (older reports have no `metrics`). */
function reportMetrics(r: TelemetryReport): Record<string, number> {
  if (r.metrics) return r.metrics;
  if (r.kind !== "device") return {};
  const d = r.device;
  const entries: [string, number | null][] = [
    ["battery_level", d.batteryLevel],
    ["voltage", d.voltage],
    ["channel_utilization", d.channelUtil],
    ["air_util_tx", d.airUtilTx],
    ["uptime_seconds", d.uptimeSeconds],
  ];
  return Object.fromEntries(entries.filter((e): e is [string, number] => e[1] !== null));
}

/**
 * A live report added to a cached series (CR-001 §6.3): a new raw sample, or merged
 * into its bucket (avg weighted by `count`, min/max widened). The window slides so it
 * still ends at the report. Reports older than the newest point are ignored.
 */
export function applyReportToSeries(dto: SeriesDTO, r: TelemetryReport): SeriesDTO {
  if (dto.kind !== r.kind) return dto;
  const last = dto.t.at(-1);
  if (last !== undefined && r.time < last) return dto;
  const values: Record<string, number | null> = { ...reportMetrics(r) };
  const battery = values.battery_level;
  if (battery !== undefined && battery !== null) {
    values.powered = battery > 100 ? 1 : 0;
    if (battery > 100) values.battery_level = null;
  }
  if ("reboot" in dto.series) {
    const uptimes = dto.series.uptime_seconds?.avg ?? [];
    const prev = [...uptimes].reverse().find((v) => v !== null);
    const now = values.uptime_seconds;
    values.reboot = prev != null && now != null && now < prev ? 1 : 0;
  }

  const span = dto.to - dto.from;
  const to = Math.max(dto.to, r.time + 1);
  const from = to - span;
  const start = dto.bucketMs > 0 ? Math.floor(r.time / dto.bucketMs) * dto.bucketMs : r.time;
  const merge = last === start;

  const t = merge ? [...dto.t] : [...dto.t, start];
  const count = merge
    ? dto.count.map((c, i) => (i === dto.count.length - 1 ? c + 1 : c))
    : [...dto.count, 1];
  const n = merge ? (dto.count.at(-1) ?? 1) : 0;
  const series: SeriesDTO["series"] = {};
  for (const [name, s] of Object.entries(dto.series)) {
    const v = values[name] ?? null;
    const push = <T>(arr: T[] | undefined, value: T) => (arr ? [...arr, value] : undefined);
    if (!merge) {
      series[name] = {
        avg: [...s.avg, v],
        ...(s.min ? { min: push(s.min, v) ?? [] } : {}),
        ...(s.max ? { max: push(s.max, v) ?? [] } : {}),
      };
      continue;
    }
    const i = s.avg.length - 1;
    const old = s.avg[i] ?? null;
    const avg = [...s.avg];
    if (name === "reboot") avg[i] = (old ?? 0) + (v ?? 0);
    else if (v !== null) avg[i] = old === null ? v : (old * n + v) / (n + 1);
    const min = s.min ? [...s.min] : undefined;
    const max = s.max ? [...s.max] : undefined;
    if (v !== null && min) min[i] = Math.min(min[i] ?? v, v);
    if (v !== null && max) max[i] = Math.max(max[i] ?? v, v);
    series[name] = { avg, ...(min ? { min } : {}), ...(max ? { max } : {}) };
  }

  // Slide: drop what fell out of the window.
  let drop = 0;
  while (drop < t.length && (t[drop] ?? 0) < from) drop++;
  const cut = <T>(arr: T[]) => arr.slice(drop);
  return {
    ...dto,
    from,
    to,
    t: cut(t),
    count: cut(count),
    series: Object.fromEntries(
      Object.entries(series).map(([k, s]) => [
        k,
        {
          avg: cut(s.avg),
          ...(s.min ? { min: cut(s.min) } : {}),
          ...(s.max ? { max: cut(s.max) } : {}),
        },
      ]),
    ),
  };
}
