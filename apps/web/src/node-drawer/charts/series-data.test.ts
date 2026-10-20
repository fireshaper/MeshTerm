import type { SeriesDTO } from "@meshterm/shared";
import { afterEach, describe, expect, it } from "vitest";
import { withAlpha } from "./chart-tokens.js";
import {
  applyReportToSeries,
  medianInterval,
  rangeBounds,
  rangeKey,
  readRange,
  RANGE_KEY,
  summarize,
  toChartData,
  writeRange,
} from "./series-data.js";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

describe("toChartData", () => {
  it("breaks the line where a gap exceeds 3× the typical interval", () => {
    const t = [0, 15, 30, 45, 200, 215].map((m) => m * MIN);
    const [x, y] = toChartData({ t, bucketMs: 0 }, [[1, 2, 3, 4, 5, 6]]);
    expect(medianInterval(t)).toBe(15 * MIN);
    expect(x).toEqual([0, 15, 30, 45, 60, 200, 215].map((m) => m * MIN));
    expect(y).toEqual([1, 2, 3, 4, null, 5, 6]);
  });

  it("uses the bucket width for bucketed series", () => {
    const [x] = toChartData({ t: [0, 5 * MIN, 30 * MIN], bucketMs: 5 * MIN }, [[1, 2, 3]]);
    expect(x).toEqual([0, 5 * MIN, 10 * MIN, 30 * MIN]);
  });
});

describe("summarize", () => {
  it("takes min and max from the band when bucketed", () => {
    const dto: SeriesDTO = {
      kind: "device",
      from: 0,
      to: 1,
      bucketMs: 5 * MIN,
      t: [0, 1],
      count: [2, 2],
      series: { battery_level: { avg: [70, 80], min: [61, 75], max: [72, 98] } },
    };
    expect(summarize(dto, "battery_level")).toEqual({ min: 61, max: 98, latest: 80 });
    expect(summarize(dto, "nope")).toEqual({ min: null, max: null, latest: null });
  });
});

describe("applyReportToSeries", () => {
  const device = (time: number, battery: number, uptime: number) => ({
    connectionId: 1,
    nodeNum: 7,
    time,
    kind: "device" as const,
    device: {
      batteryLevel: battery,
      voltage: null,
      channelUtil: null,
      airUtilTx: null,
      uptimeSeconds: uptime,
    },
    metrics: { battery_level: battery, uptime_seconds: uptime },
  });

  it("raw: appends the sample and slides the window", () => {
    const dto: SeriesDTO = {
      kind: "device",
      from: NOW - 60 * MIN,
      to: NOW,
      bucketMs: 0,
      t: [NOW - 59 * MIN, NOW - 30 * MIN],
      count: [1, 1],
      series: {
        battery_level: { avg: [80, 79] },
        powered: { avg: [0, 0] },
        uptime_seconds: { avg: [100, 200] },
        reboot: { avg: [0, 0] },
      },
    };
    const next = applyReportToSeries(dto, device(NOW + 2 * MIN, 101, 5));
    expect(next.t).toEqual([NOW - 30 * MIN, NOW + 2 * MIN]);
    expect(next.series.battery_level?.avg).toEqual([79, null]);
    expect(next.series.powered?.avg).toEqual([0, 1]);
    expect(next.series.reboot?.avg).toEqual([0, 1]);
    expect(next.to - next.from).toBe(60 * MIN);
    // Older than the newest point: ignored; another kind: ignored.
    expect(applyReportToSeries(next, device(NOW, 50, 1))).toBe(next);
    expect(
      applyReportToSeries(next, { ...device(NOW + 5 * MIN, 50, 9), kind: "power", metrics: {} }),
    ).toBe(next);
  });

  it("bucketed: merges into the current bucket by count", () => {
    const start = Math.floor(NOW / (5 * MIN)) * 5 * MIN;
    const dto: SeriesDTO = {
      kind: "device",
      from: start - 24 * 60 * MIN,
      to: start + MIN,
      bucketMs: 5 * MIN,
      t: [start],
      count: [3],
      series: { battery_level: { avg: [60], min: [58], max: [62] } },
    };
    const next = applyReportToSeries(dto, device(start + 2 * MIN, 70, 1));
    expect(next.t).toEqual([start]);
    expect(next.count).toEqual([4]);
    expect(next.series.battery_level).toEqual({ avg: [62.5], min: [58], max: [70] });
    const later = applyReportToSeries(next, device(start + 6 * MIN, 50, 2));
    expect(later.t).toEqual([start, start + 5 * MIN]);
    expect(later.series.battery_level?.min).toEqual([58, 50]);
  });
});

describe("ranges", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("presets end now; custom ranges are fixed; both are remembered", () => {
    expect(rangeBounds({ preset: "1h" }, NOW)).toEqual({ from: NOW - 60 * MIN, to: NOW });
    expect(rangeKey({ preset: "custom", from: 1, to: 2 })).toBe("custom:1-2");
    expect(readRange()).toEqual({ preset: "24h" });
    writeRange({ preset: "custom", from: 10, to: 20 });
    expect(readRange()).toEqual({ preset: "custom", from: 10, to: 20 });
    localStorage.setItem(RANGE_KEY, '{"preset":"forever"}');
    expect(readRange()).toEqual({ preset: "24h" });
  });
});

describe("withAlpha", () => {
  it("adds an alpha to rgb and hex colors", () => {
    expect(withAlpha("rgb(85, 168, 255)", 0.2)).toBe("rgba(85, 168, 255, 0.2)");
    expect(withAlpha("#35d49a", 0.5)).toBe("rgba(53, 212, 154, 0.5)");
    expect(withAlpha("currentcolor", 0.5)).toBe("currentcolor");
  });
});
