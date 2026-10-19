import { FakeNode } from "@meshterm/fake-node";
import { DEFAULT_DASHBOARD_THRESHOLDS, type DashboardDTO, type NodeCard } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordTelemetry } from "../db/telemetry.js";
import { openTestDatabase } from "../db/test-db.js";
import { settings } from "../db/schema.js";
import { startTestApp, type TestApp } from "../test-app.js";
import { batterySparks, getThresholds, setThresholds, SPARK_BUCKET_MS } from "./dashboard.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;
const GARAGE = 0x5e6f7081;
const HILLTOP = 0x22334455;
const KAYAK = 0x33445566;
const BIKE = 0x55667788;

describe("GET /api/connections/:id/dashboard (dashboard scenario)", () => {
  let t: TestApp;
  let T: number;

  beforeEach(async () => {
    T = Date.now();
    t = await startTestApp({ node: new FakeNode({ scenario: "dashboard", now: () => T }) });
    // The environment sensor reports right after the handshake.
    await waitForDashboard((d) => (card(d)?.environment ?? null) !== null);
  });

  afterEach(async () => {
    await t.close();
  });

  function card(dto: DashboardDTO, num = GARAGE): NodeCard | undefined {
    return dto.nodes.find((n) => n.num === num);
  }
  async function fetchDashboard(): Promise<DashboardDTO> {
    const res = await t.app.inject({ method: "GET", url: "/api/connections/1/dashboard" });
    expect(res.statusCode).toBe(200);
    return res.json<DashboardDTO>();
  }
  async function waitForDashboard(predicate: (d: DashboardDTO) => boolean): Promise<DashboardDTO> {
    const deadline = Date.now() + 3_000;
    for (;;) {
      const dto = await fetchDashboard();
      if (predicate(dto)) return dto;
      if (Date.now() > deadline) throw new Error("dashboard never matched");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("summarizes the mesh", async () => {
    const { summary, thresholds } = await fetchDashboard();
    expect(summary).toMatchObject({
      connectionId: 1,
      connectionState: "connected",
      nodesTotal: 7,
      // Self (0 s), Ridge (2 min) and Garage (10 min) are within 15 minutes.
      nodesOnline: 3,
      myNodeNum: ME,
      myBattery: 87,
      channelUtil: 12.5,
      airUtilTx: 3.2,
      messages24h: 0,
    });
    expect(summary.connectedSince).toBeGreaterThan(T - 10_000);
    expect(summary.lastPacketAt).not.toBeNull();
    expect(thresholds).toEqual(DEFAULT_DASHBOARD_THRESHOLDS);
  });

  it("puts my node first, then the most recently heard", async () => {
    const { nodes } = await fetchDashboard();
    // Garage Station broadcast its environment reading just now, so it was heard last.
    expect(nodes.map((n) => n.shortName)).toEqual([
      "MTB",
      "GAR",
      "RDG",
      "TRL",
      "HIL",
      "KYK",
      "BIK",
    ]);
    expect(nodes.filter((n) => n.isSelf).map((n) => n.num)).toEqual([ME]);
  });

  it("fills every card field from the stored data", async () => {
    const dto = await fetchDashboard();
    expect(card(dto, RIDGE)).toEqual({
      num: RIDGE,
      userId: "!0badcafe",
      longName: "Ridge Repeater",
      shortName: "RDG",
      role: "ROUTER",
      hwModel: "RAK4631",
      isFavorite: true,
      isSelf: false,
      lastHeard: Math.floor(T / 1000) * 1000 - 120_000,
      hopsAway: 0,
      snr: 7.25,
      rssi: null,
      position: {
        lat: 47.65,
        lon: -122.28,
        alt: 312,
        precisionBits: null,
        time: Math.floor(T / 1000) * 1000 - 120_000,
      },
      device: {
        batteryLevel: 101, // powered
        voltage: 5.1,
        channelUtil: 9.1,
        airUtilTx: 1.4,
        uptimeSeconds: 1_209_600,
        time: Math.floor(T / 1000) * 1000 - 120_000,
      },
      environment: null,
      batterySpark: [
        [
          Math.floor((Math.floor(T / 1000) * 1000 - 120_000) / SPARK_BUCKET_MS) * SPARK_BUCKET_MS,
          101,
        ],
      ],
    });
    expect(card(dto, TRAIL)?.position?.precisionBits).toBe(13);
    expect(card(dto, GARAGE)).toMatchObject({
      hopsAway: 2,
      environment: { temperature: 22.4, humidity: 61, pressure: 1013.2 },
    });
    expect(card(dto, HILLTOP)).toMatchObject({ isFavorite: true, device: { batteryLevel: 15 } });
    // Offline for 3 days: older than the 24 h spark window.
    expect(card(dto, KAYAK)).toMatchObject({
      position: null,
      device: { batteryLevel: 8 },
      batterySpark: [],
    });
    expect(card(dto, BIKE)).toMatchObject({
      lastHeard: null,
      hopsAway: null,
      position: null,
      device: null,
      environment: null,
      batterySpark: [],
    });
  });

  it("counts messages from the last 24 hours", async () => {
    t.node.injectText(RIDGE, { channel: 0 }, "hello dashboard");
    const dto = await waitForDashboard((d) => d.summary.messages24h > 0);
    expect(dto.summary.messages24h).toBe(1);
  });

  it("returns 404 for an unknown connection", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/connections/9/dashboard" });
    expect(res.statusCode).toBe(404);
  });
});

describe("batterySparks", () => {
  it("averages into 30-minute buckets over the last 24 hours, at most 48 points", () => {
    const handle = openTestDatabase();
    const now = 1_800_000_000_000;
    const report = (time: number, batteryLevel: number | null) => ({
      connectionId: 1,
      nodeNum: RIDGE,
      time,
      kind: "device" as const,
      device: {
        batteryLevel,
        voltage: null,
        channelUtil: null,
        airUtilTx: null,
        uptimeSeconds: null,
      },
    });
    // Every 10 minutes for 26 hours: 3 reports per bucket.
    for (let i = 0; i < 26 * 6; i++)
      recordTelemetry(handle.db, report(now - i * 600_000, 50 + (i % 3)));
    recordTelemetry(handle.db, report(now - 5_000, null)); // ignored: no battery level

    const spark = batterySparks(handle.db, 1, now).get(RIDGE) ?? [];
    expect(spark.length).toBeLessThanOrEqual(48);
    expect(spark.length).toBeGreaterThanOrEqual(47);
    expect(spark.every(([time]) => time >= now - 24 * 3600 * 1000 - SPARK_BUCKET_MS)).toBe(true);
    expect(spark.every(([time]) => time % SPARK_BUCKET_MS === 0)).toBe(true);
    expect(spark.map(([time]) => time)).toEqual(
      [...spark.map(([time]) => time)].sort((a, b) => a - b),
    );
    // A full bucket holds 50, 51 and 52 → average 51.
    expect(spark.slice(1, -1).every(([, level]) => level === 51)).toBe(true);
    handle.close();
  });
});

describe("thresholds setting", () => {
  it("overrides defaults field by field, and a broken setting falls back to defaults", () => {
    const handle = openTestDatabase();
    expect(getThresholds(handle.db)).toEqual(DEFAULT_DASHBOARD_THRESHOLDS);
    setThresholds(handle.db, { onlineMin: 30 });
    expect(getThresholds(handle.db)).toEqual({ ...DEFAULT_DASHBOARD_THRESHOLDS, onlineMin: 30 });
    handle.db.update(settings).set({ value: "{not json" }).run();
    expect(getThresholds(handle.db)).toEqual(DEFAULT_DASHBOARD_THRESHOLDS);
    handle.close();
  });
});
