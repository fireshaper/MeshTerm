import { FakeNode, until } from "@meshterm/fake-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connections, nodes } from "../db/schema.js";
import { startTestApp, type TestApp } from "../test-app.js";
import { WsTestClient } from "../ws/test-client.js";

const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;
const GARAGE = 0x5e6f7081;

let t: TestApp;
let ws: WsTestClient;

beforeEach(async () => {
  t = await startTestApp({ node: new FakeNode({ scenario: "dashboard" }) });
  await t.app.listen({ host: "127.0.0.1", port: 0 });
  ws = await WsTestClient.open(t.app);
  ws.send({ type: "subscribe", connectionId: 1 });
  await ws.next("snapshot");
});

afterEach(async () => {
  ws.close();
  await t.close();
});

const nodeRow = (num: number) => {
  const row = t.app.meshterm.db
    .select({
      battery_level: nodes.batteryLevel,
      voltage: nodes.voltage,
      lat: nodes.lat,
      lon: nodes.lon,
      precision_bits: nodes.precisionBits,
      temperature: nodes.temperature,
      rssi: nodes.rssi,
    })
    .from(nodes)
    .where(eq(nodes.num, num))
    .get();
  if (!row) throw new Error(`no node ${num}`);
  return row;
};

describe("telemetry and position pipeline", () => {
  it("stores the handshake's positions and device metrics, and the sensor's environment", async () => {
    await until(() => nodeRow(GARAGE).temperature !== null);
    expect(nodeRow(RIDGE)).toMatchObject({
      battery_level: 101,
      voltage: 5.1,
      lat: 47.65,
      lon: -122.28,
    });
    expect(nodeRow(TRAIL)).toMatchObject({ precision_bits: 13 });
    expect(nodeRow(GARAGE)).toMatchObject({ temperature: 22.4 });
    const connection = t.app.meshterm.db.select().from(connections).get();
    expect(connection?.lastPacketAt).not.toBeNull();
  });

  it("injected telemetry and position are stored and reach WS clients", async () => {
    t.node.injectTelemetry(RIDGE, {
      variant: { case: "deviceMetrics", value: { batteryLevel: 55, voltage: 3.9 } },
    });
    const telemetry = await ws.next("telemetry.new");
    expect(telemetry.telemetry).toMatchObject({
      nodeNum: RIDGE,
      kind: "device",
      device: { batteryLevel: 55, voltage: 3.9 },
    });

    t.node.injectPosition(TRAIL, { latitudeI: 475950000, longitudeI: -1221100000, altitude: 400 });
    const position = await ws.next("position.new");
    expect(position.position).toMatchObject({ nodeNum: TRAIL, lat: 47.595, lon: -122.11 });

    expect(nodeRow(RIDGE)).toMatchObject({ battery_level: 55, voltage: 3.9, rssi: -72 });
    expect(nodeRow(TRAIL)).toMatchObject({ lat: 47.595, lon: -122.11 });
  });

  it("an older telemetry report doesn't overwrite newer latest values", async () => {
    t.node.injectTelemetry(RIDGE, {
      variant: { case: "deviceMetrics", value: { batteryLevel: 55 } },
    });
    await ws.next("telemetry.new");
    const seen = ws.messages.length;
    t.node.injectTelemetry(RIDGE, {
      time: 1_000_000_000, // 2001
      variant: { case: "deviceMetrics", value: { batteryLevel: 12 } },
    });
    await ws.next("telemetry.new", seen);
    expect(nodeRow(RIDGE).battery_level).toBe(55);
  });
});
