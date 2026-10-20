import { fixtures } from "@meshterm/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyNodeToDetail,
  applyPositionToDetail,
  applyTelemetryToDetail,
} from "../data/node-detail-cache.js";
import { scenarioNodeDetail } from "../test/scenario.js";
import { formatMetric, metricInfo, orderedMetrics } from "./metrics.js";
import { clampWidth, DRAWER_WIDTH_KEY, readDrawerWidth, writeDrawerWidth } from "./width.js";

const NOW = 1_800_000_000_000;
const GARAGE = 0x5e6f7081;

describe("metric labels and units", () => {
  it("formats known metrics, channels and unknown names", () => {
    expect(formatMetric("temperature", 21.53)).toBe("21.5 °C");
    expect(formatMetric("relative_humidity", 61.4)).toBe("61%");
    expect(formatMetric("battery_level", 101)).toBe("External power");
    expect(formatMetric("uptime_seconds", 90_061)).toBe("1d 1h");
    expect(metricInfo("ch3_current")).toEqual({
      label: "Channel 3 current",
      unit: "mA",
      digits: 0,
    });
    expect(metricInfo("new_sensor_thing").label).toBe("New sensor thing");
    expect(orderedMetrics({ lux: 1, temperature: 2, zzz: 3 }).map(([k]) => k)).toEqual([
      "temperature",
      "lux",
      "zzz",
    ]);
  });
});

describe("node detail cache", () => {
  const base = () => scenarioNodeDetail(GARAGE, "dashboard", NOW);

  it("node.upsert updates the open node only; unchanged data stays the same object", () => {
    const d = base();
    const node = {
      ...fixtures.node,
      num: GARAGE,
      id: "!5e6f7081",
      longName: d.longName,
      shortName: d.shortName,
      role: d.role,
      hwModel: d.hwModel,
      lastHeard: d.lastHeard,
      snr: d.snr,
      hopsAway: d.hopsAway,
      isFavorite: d.isFavorite,
      isIgnored: d.isIgnored,
    };
    expect(applyNodeToDetail(d, node)).toBe(d);
    expect(applyNodeToDetail(d, { ...node, longName: "Renamed" }).longName).toBe("Renamed");
    expect(applyNodeToDetail(d, { ...node, num: 1 })).toBe(d);
  });

  it("telemetry.new becomes the latest of its kind and adds new kinds", () => {
    const d = applyTelemetryToDetail(base(), {
      connectionId: 1,
      nodeNum: GARAGE,
      time: NOW,
      kind: "power",
      metrics: { ch1_voltage: 12.5 },
    });
    expect(d.latestTelemetry.power).toEqual({ time: NOW, metrics: { ch1_voltage: 12.5 } });
    expect(d.telemetryKinds).toContain("power");
    const older = applyTelemetryToDetail(d, {
      connectionId: 1,
      nodeNum: GARAGE,
      time: NOW - 1,
      kind: "power",
      metrics: { ch1_voltage: 1 },
    });
    expect(older).toBe(d);
    const device = applyTelemetryToDetail(d, {
      connectionId: 1,
      nodeNum: GARAGE,
      time: NOW + 1,
      kind: "device",
      device: {
        batteryLevel: 42,
        voltage: null,
        channelUtil: null,
        airUtilTx: null,
        uptimeSeconds: 5,
      },
      metrics: { battery_level: 42, uptime_seconds: 5 },
    });
    expect(device.device?.batteryLevel).toBe(42);
    expect(device.device?.voltage).toBe(d.device?.voltage);
  });

  it("position.new moves the node unless older", () => {
    const d = applyPositionToDetail(base(), {
      connectionId: 1,
      nodeNum: GARAGE,
      lat: 47,
      lon: -122,
      altitude: null,
      precisionBits: null,
      time: NOW + 10,
    });
    expect(d.position).toMatchObject({ lat: 47, lon: -122, time: NOW + 10 });
    const older = {
      connectionId: 1,
      nodeNum: GARAGE,
      lat: 1,
      lon: 1,
      altitude: null,
      precisionBits: null,
      time: NOW,
    };
    expect(applyPositionToDetail(d, older)).toBe(d);
  });
});

describe("drawer width", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("is clamped to 400–800 px, remembered, and survives blocked storage", () => {
    expect(clampWidth(10)).toBe(400);
    expect(clampWidth(5000)).toBe(800);
    expect(readDrawerWidth()).toBeNull();
    writeDrawerWidth(612.4);
    expect(readDrawerWidth()).toBe(612);
    localStorage.setItem(DRAWER_WIDTH_KEY, "junk");
    expect(readDrawerWidth()).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(readDrawerWidth()).toBeNull();
  });
});
