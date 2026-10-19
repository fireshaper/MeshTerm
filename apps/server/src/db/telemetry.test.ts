import type { NodePosition, TelemetryReport } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "./database.js";
import { recordPosition, recordTelemetry, setLastPacketAt, setNodeRssi } from "./telemetry.js";
import { openTestDatabase } from "./test-db.js";

const NODE = 0x0badcafe;
let handle: DatabaseHandle;

beforeEach(() => {
  handle = openTestDatabase();
});

afterEach(() => {
  handle.close();
});

const nodeRow = () =>
  handle.sqlite
    .prepare(
      "SELECT battery_level, voltage, channel_util, device_time, temperature, env_time, lat, lon, precision_bits, position_time, rssi FROM nodes WHERE num = ?",
    )
    .get(NODE) as Record<string, number | null> | undefined;
const count = (table: string) =>
  (handle.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

const device = (time: number, d: Partial<Extract<TelemetryReport, { kind: "device" }>["device"]>) =>
  ({
    connectionId: 1,
    nodeNum: NODE,
    time,
    kind: "device",
    device: {
      batteryLevel: null,
      voltage: null,
      channelUtil: null,
      airUtilTx: null,
      uptimeSeconds: null,
      ...d,
    },
  }) satisfies TelemetryReport;

const position = (time: number, lat: number): NodePosition => ({
  connectionId: 1,
  nodeNum: NODE,
  lat,
  lon: -122.3,
  altitude: 10,
  precisionBits: 13,
  time,
});

describe("telemetry storage", () => {
  it("creates a placeholder node, stores history and the latest values", () => {
    expect(recordTelemetry(handle.db, device(1_000, { batteryLevel: 80, voltage: 4 }))).toBe(true);
    expect(count("telemetry")).toBe(1);
    expect(nodeRow()).toMatchObject({ battery_level: 80, voltage: 4, device_time: 1_000 });
  });

  it("ignores a repeated report (same node, kind and time)", () => {
    recordTelemetry(handle.db, device(1_000, { batteryLevel: 80 }));
    expect(recordTelemetry(handle.db, device(1_000, { batteryLevel: 80 }))).toBe(false);
    expect(count("telemetry")).toBe(1);
  });

  it("an older report adds history but doesn't overwrite newer latest values", () => {
    recordTelemetry(handle.db, device(2_000, { batteryLevel: 70 }));
    recordTelemetry(handle.db, device(1_000, { batteryLevel: 90 }));
    expect(count("telemetry")).toBe(2);
    expect(nodeRow()).toMatchObject({ battery_level: 70, device_time: 2_000 });
  });

  it("a partial report keeps the fields it doesn't mention", () => {
    recordTelemetry(handle.db, device(1_000, { batteryLevel: 80, voltage: 4, channelUtil: 12 }));
    recordTelemetry(handle.db, device(2_000, { batteryLevel: 79 }));
    expect(nodeRow()).toMatchObject({
      battery_level: 79,
      voltage: 4,
      channel_util: 12,
      device_time: 2_000,
    });
  });

  it("environment readings are tracked separately from device metrics", () => {
    recordTelemetry(handle.db, device(5_000, { batteryLevel: 50 }));
    recordTelemetry(handle.db, {
      connectionId: 1,
      nodeNum: NODE,
      time: 1_000,
      kind: "environment",
      environment: { temperature: 21.5, humidity: 40, pressure: 1010 },
    });
    expect(nodeRow()).toMatchObject({ battery_level: 50, temperature: 21.5, env_time: 1_000 });
  });
});

describe("position storage", () => {
  it("stores history and the latest position, never older over newer", () => {
    expect(recordPosition(handle.db, position(2_000, 47.6), 2_500)).toBe(true);
    expect(recordPosition(handle.db, position(1_000, 47.0), 2_600)).toBe(true);
    expect(recordPosition(handle.db, position(2_000, 47.6), 2_700)).toBe(false);
    expect(count("positions")).toBe(2);
    expect(nodeRow()).toMatchObject({ lat: 47.6, precision_bits: 13, position_time: 2_000 });
  });
});

describe("rssi and last packet", () => {
  it("sets rssi and moves last_packet_at forward only", () => {
    recordTelemetry(handle.db, device(1, {}));
    setNodeRssi(handle.db, 1, NODE, -90);
    expect(nodeRow()?.rssi).toBe(-90);

    const lastPacket = () =>
      (
        handle.sqlite.prepare("SELECT last_packet_at AS t FROM connections WHERE id = 1").get() as {
          t: number | null;
        }
      ).t;
    setLastPacketAt(handle.db, 1, 5_000);
    setLastPacketAt(handle.db, 1, 4_000);
    expect(lastPacket()).toBe(5_000);
  });
});
