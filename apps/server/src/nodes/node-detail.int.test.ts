// CR-001 §6: node detail, telemetry/signal series and CSV, against FakeNode's
// backdated history fixture on the `dashboard` scenario.
import { FakeNode, HISTORY_NODES, until } from "@meshterm/fake-node";
import type { NodeDetailDTO, SeriesDTO, SignalDTO } from "@meshterm/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { telemetry } from "../db/schema.js";
import { startTestApp, type TestApp } from "../test-app.js";

const { garden, ridge, trail, hill, bike } = HISTORY_NODES;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

let t: TestApp;
let packets = 0;

beforeAll(async () => {
  const node = new FakeNode({ scenario: "dashboard" });
  t = await startTestApp({ node });
  // 8 days cover the gap (3 d ago) and the reboot (5 d ago) and keep the test quick.
  packets = node.injectHistory(8);
  const rows = () =>
    t.app.meshterm.db.get<{ n: number } | undefined>(sql`SELECT count(*) AS n FROM ${telemetry}`)
      ?.n ?? 0;
  // The handshake stored a few NodeInfo device metrics too.
  await until(() => rows() >= packets, 60_000);
}, 90_000);

afterAll(async () => {
  await t.close();
});

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed test helper
const get = async <T = unknown>(path: string) => {
  const res = await t.app.inject({ url: `/api/connections/1/${path}` });
  const json = res.headers["content-type"]?.toString().includes("json");
  return { status: res.statusCode, body: (json ? res.json() : undefined) as T, res };
};
const now = () => Date.now();
const range = (span: number) => `from=${now() - span}&to=${now()}`;

describe("GET /api/connections/:id/nodes/:num", () => {
  it("describes a battery node: kinds, latest metrics, 24 h stats, first seen", async () => {
    const { status, body } = await get<NodeDetailDTO>(`nodes/${garden}`);
    expect(status).toBe(200);
    expect(body.shortName).toBe("GAR");
    // (Its handshake NodeInfo also reported environment readings.)
    expect(body.telemetryKinds).toContain("device");
    // The newest report is the handshake's NodeInfo copy (fewer fields than the history).
    expect(body.latestTelemetry.device?.metrics).toHaveProperty("battery_level");
    expect(body.stats24h.packets).toBeGreaterThan(0);
    expect(body.stats24h.batteryMin).toBeGreaterThanOrEqual(55);
    expect(body.stats24h.batteryMax).toBeLessThanOrEqual(100);
    expect(body.firstSeen).toBeGreaterThan(now() - HOUR);
    expect(body.publicKeyFingerprint).toBeNull();
  });

  it("gives the key fingerprint, power and environment kinds, and our own firmware", async () => {
    const r = (await get<NodeDetailDTO>(`nodes/${ridge}`)).body;
    expect(r.publicKeyFingerprint).toBe("0b30557a9fc4e90e");
    expect(r.publicKey).toHaveLength(64);
    expect((await get<NodeDetailDTO>(`nodes/${trail}`)).body.telemetryKinds).toEqual([
      "device",
      "environment",
    ]);
    const h = (await get<NodeDetailDTO>(`nodes/${hill}`)).body;
    expect(h.telemetryKinds).toContain("power");
    expect(h.latestTelemetry.power?.metrics).toHaveProperty("ch1_current");
    expect((await get<NodeDetailDTO>(`nodes/${bike}`)).body.telemetryKinds).toEqual([]);
    expect((await get<NodeDetailDTO>("nodes/2712847316")).body.firmware).toMatch(/^\d+\.\d+/);
  });

  it("is 404 for an unknown node", async () => {
    expect((await get("nodes/305419896")).status).toBe(404);
  });
});

describe("GET …/nodes/:num/telemetry", () => {
  it("1 h: raw samples", async () => {
    const { body } = await get<SeriesDTO>(`nodes/${garden}/telemetry?${range(HOUR)}`);
    expect(body.bucketMs).toBe(0);
    expect(body.t.length).toBeGreaterThanOrEqual(3);
    expect(body.t.length).toBeLessThanOrEqual(5);
    expect(body.series.battery_level?.min).toBeUndefined();
  });

  it("24 h: 5-min buckets with avg, min and max", async () => {
    const { body } = await get<SeriesDTO>(`nodes/${garden}/telemetry?${range(DAY)}`);
    expect(body.bucketMs).toBe(5 * 60_000);
    expect(body.t.length).toBeGreaterThan(90);
    const b = body.series.battery_level;
    expect(b?.avg.length).toBe(body.t.length);
    expect(b?.min?.every((v, i) => v === null || v <= (b.max?.[i] ?? Infinity))).toBe(true);
    expect(body.series.powered?.avg.every((v) => v === 0)).toBe(true);
  });

  it("7 d: 30-min buckets and the 6 h gap is missing, not filled", async () => {
    const { body } = await get<SeriesDTO>(`nodes/${garden}/telemetry?${range(7 * DAY)}`);
    expect(body.bucketMs).toBe(30 * 60_000);
    const gaps = body.t.slice(1).map((x, i) => x - (body.t[i] ?? x));
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(6 * HOUR);
  });

  it("30 d: 2 h buckets, ≤ 1 000 points, one reboot", async () => {
    // Only 8 days are stored here; the range still picks 2 h buckets.
    // Ends an hour ago: the handshake's NodeInfo uptime (10 min ago) isn't part of the history.
    const to = now() - HOUR;
    const { body } = await get<SeriesDTO>(
      `nodes/${garden}/telemetry?from=${to - 30 * DAY}&to=${to}`,
    );
    expect(body.bucketMs).toBe(2 * HOUR);
    expect(body.t.length).toBeLessThanOrEqual(1_000);
    expect(body.series.reboot?.avg.reduce<number>((n, v) => n + (v ?? 0), 0)).toBe(1);
  });

  it("external power is a `powered` series, not a battery percentage", async () => {
    const { body } = await get<SeriesDTO>(`nodes/${ridge}/telemetry?${range(DAY)}`);
    expect(body.series.battery_level?.avg.every((v) => v === null)).toBe(true);
    expect(body.series.powered?.avg.every((v) => v === 1)).toBe(true);
  });

  it("environment and power-monitor metrics come from what the node reports", async () => {
    const env = (await get<SeriesDTO>(`nodes/${trail}/telemetry?kind=environment&${range(DAY)}`))
      .body;
    expect(Object.keys(env.series)).toEqual([
      "temperature",
      "relative_humidity",
      "barometric_pressure",
      "gas_resistance",
      "lux",
    ]);
    const power = (await get<SeriesDTO>(`nodes/${hill}/telemetry?kind=power&${range(DAY)}`)).body;
    expect(Object.keys(power.series).sort()).toEqual([
      "ch1_current",
      "ch1_voltage",
      "ch2_current",
      "ch2_voltage",
    ]);
  });

  it("metrics= picks series; a bad name or a too-long range is 400", async () => {
    const { body } = await get<SeriesDTO>(
      `nodes/${garden}/telemetry?metrics=voltage&${range(DAY)}`,
    );
    expect(Object.keys(body.series)).toEqual(["voltage"]);
    expect((await get(`nodes/${garden}/telemetry?metrics=x;drop`)).status).toBe(400);
    expect((await get(`nodes/${garden}/telemetry?from=0&to=${now()}`)).status).toBe(400);
  });

  it("a node without telemetry has empty series", async () => {
    const { body } = await get<SeriesDTO>(`nodes/${bike}/telemetry?${range(DAY)}`);
    expect(body.t).toEqual([]);
    expect(body.series).toEqual({});
  });
});

describe("GET …/nodes/:num/signal", () => {
  it("SNR/RSSI only from packets heard directly; hops and packet counts from all", async () => {
    const direct = (await get<SignalDTO>(`nodes/${ridge}/signal?${range(DAY)}`)).body;
    expect(direct.series.snr?.avg.some((v) => v !== null)).toBe(true);
    expect(direct.series.rssi?.avg.every((v) => v === null || v < -60)).toBe(true);
    expect(direct.rate.bucketMs).toBe(HOUR);
    expect(direct.rate.packets.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(90);

    const relayed = (await get<SignalDTO>(`nodes/${garden}/signal?${range(DAY)}`)).body;
    expect(relayed.series.snr?.avg.every((v) => v === null)).toBe(true);
    expect(relayed.series.hops?.avg.some((v) => v === 2)).toBe(true);
  });
});

describe("GET …/nodes/:num/telemetry.csv", () => {
  it("downloads raw rows of every kind with one column per metric", async () => {
    const { res } = await get(`nodes/${trail}/telemetry.csv?${range(DAY)}`);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("node-1a2b3c4d-telemetry.csv");
    const lines = res.body.trim().split("\n");
    expect(lines[0]).toMatch(/^time,kind,.*temperature/);
    expect(lines.length).toBeGreaterThan(40);
    expect(lines[1]).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});
