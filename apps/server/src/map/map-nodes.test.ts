import { FakeNode } from "@meshterm/fake-node";
import type { MapNodesDTO } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";
import { precisionMeters, statusOf } from "./map-nodes.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;
const HILL = 0x22334455;
const KAYAK = 0x33445566;
const BIKE = 0x55667788;

let t: TestApp;
const T = 1_800_000_000_000;

beforeEach(async () => {
  t = await startTestApp({ node: new FakeNode({ scenario: "dashboard", now: () => T }) });
});

afterEach(async () => {
  await t.close();
});

const get = async (query = "") => {
  const res = await t.app.inject({ method: "GET", url: `/api/connections/1/map/nodes${query}` });
  expect(res.statusCode).toBe(200);
  return res.json<MapNodesDTO>();
};

describe("GET /map/nodes", () => {
  it("returns every node with a position as a GeoJSON point, old ones included", async () => {
    const dto = await get();
    expect(dto.type).toBe("FeatureCollection");
    const byNum = new Map(dto.features.map((f) => [f.id, f]));
    expect([...byNum.keys()].sort()).toEqual([ME, RIDGE, TRAIL, 1584361601, HILL].sort());
    const ridge = byNum.get(RIDGE);
    expect(ridge?.geometry).toEqual({ type: "Point", coordinates: [-122.28, 47.65] });
    expect(ridge?.properties).toMatchObject({
      num: RIDGE,
      userId: "!0badcafe",
      shortName: "RDG",
      longName: "Ridge Repeater",
      role: "ROUTER",
      isSelf: false,
      isFavorite: true,
      precisionMeters: null,
      batteryLevel: 101,
      hopsAway: 0,
      snr: 7.25,
    });
    expect(byNum.get(TRAIL)?.properties.precisionMeters).toBe(2913);
    expect(byNum.get(ME)?.properties).toMatchObject({ isSelf: true, snr: null });
  });

  it("lists nodes without a position separately, most recently heard first", async () => {
    const dto = await get();
    expect(dto.unplaced.map((n) => n.num)).toEqual([KAYAK, BIKE]);
    expect(dto.thresholds.staleMin).toBe(1440);
  });

  it("since= limits by last heard", async () => {
    const dto = await get(`?since=${T - 3600_000}`);
    // Hilltop was heard 7 h ago: left out.
    expect(dto.features.map((f) => f.id)).not.toContain(HILL);
    expect(dto.features.map((f) => f.id)).toContain(RIDGE);
  });

  it("404s an unknown connection", async () => {
    const res = await t.app.inject({ url: "/api/connections/9/map/nodes" });
    expect(res.statusCode).toBe(404);
  });
});

describe("helpers", () => {
  it("statusOf uses the dashboard thresholds", () => {
    const th = { onlineMin: 15, recentMin: 120, staleMin: 1440 };
    expect([0, 14, 15, 119, 120, 1439, 1440].map((m) => statusOf(T - m * 60_000, T, th))).toEqual([
      "online",
      "online",
      "recent",
      "recent",
      "stale",
      "stale",
      "offline",
    ]);
    expect(statusOf(null, T, th)).toBe("offline");
  });

  it("precisionMeters follows the Meshtastic table", () => {
    expect([null, 0, 10, 13, 16, 32].map(precisionMeters)).toEqual([
      null,
      null,
      23_300,
      2913,
      364,
      null,
    ]);
  });
});
