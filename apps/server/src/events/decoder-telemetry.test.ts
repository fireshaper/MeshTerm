import { FakeNode, RawClient } from "@meshterm/fake-node";
import { Portnums, type FromRadio } from "@meshterm/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFromRadio, nodeHeard, type DecodeContext } from "./decoder.js";
import type { RadioEvent } from "./events.js";

const RECORDED_AT_MS = 1_800_000_000_000;
const NOW = 1_900_000_000_000;
const ctx: DecodeContext = { connectionId: 1, now: NOW, newId: () => "unused" };
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;
const GARAGE = 0x5e6f7081;
const KAYAK = 0x33445566;

let node: FakeNode;
let client: RawClient;
let handshake: FromRadio[];

const isPort = (m: FromRadio | undefined, port: Portnums.PortNum) =>
  m?.payloadVariant.case === "packet" &&
  m.payloadVariant.value.payloadVariant.case === "decoded" &&
  m.payloadVariant.value.payloadVariant.value.portnum === port;

/** The next frame received after running `act`. */
async function next(act: () => void): Promise<FromRadio> {
  const count = client.received.length;
  act();
  await client.waitFor((r) => r.length > count);
  return client.received[count] as FromRadio;
}

beforeAll(async () => {
  node = new FakeNode({ scenario: "dashboard", now: () => RECORDED_AT_MS });
  await node.start();
  client = await RawClient.open(node.port);
  client.send({ payloadVariant: { case: "wantConfigId", value: 1 } });
  // The handshake, then the environment sensor's telemetry broadcast.
  await client.waitFor((r) => r.some((m) => isPort(m, Portnums.PortNum.TELEMETRY_APP)));
  handshake = [...client.received];
});

afterAll(async () => {
  client.close();
  await node.stop();
});

const decode = (m: FromRadio) => decodeFromRadio(m, ctx).events;
const ofType = <T extends RadioEvent["type"]>(events: RadioEvent[], type: T) =>
  events.filter((e): e is Extract<RadioEvent, { type: T }> => e.type === type);
const nodeInfoFor = (num: number) =>
  handshake.find((m) => m.payloadVariant.case === "nodeInfo" && m.payloadVariant.value.num === num);

describe("decoding telemetry and position", () => {
  it("handshake NodeInfo yields the node, its position and its device metrics", () => {
    const ridge = nodeInfoFor(RIDGE);
    if (!ridge) throw new Error("no ridge NodeInfo");
    const events = decode(ridge);
    expect(events.map((e) => e.type)).toEqual(["radio.node", "radio.position", "radio.telemetry"]);
    const heardAt = RECORDED_AT_MS - 120_000;
    expect(ofType(events, "radio.position")[0]?.payload.position).toEqual({
      connectionId: 1,
      nodeNum: RIDGE,
      lat: 47.65,
      lon: -122.28,
      altitude: 312,
      precisionBits: null,
      time: heardAt,
    });
    expect(ofType(events, "radio.telemetry")[0]?.payload.report).toEqual({
      connectionId: 1,
      nodeNum: RIDGE,
      time: heardAt,
      kind: "device",
      device: {
        batteryLevel: 101,
        voltage: 5.1,
        channelUtil: 9.1,
        airUtilTx: 1.4,
        uptimeSeconds: 1_209_600,
      },
    });
  });

  it("keeps reduced precision, and reports only the metrics a node sent", () => {
    const events = decode(nodeInfoFor(TRAIL) ?? (handshake[0] as FromRadio));
    expect(ofType(events, "radio.position")[0]?.payload.position).toMatchObject({
      precisionBits: 13,
      altitude: 410,
    });
    expect(ofType(events, "radio.telemetry")[0]?.payload.report).toMatchObject({
      device: {
        batteryLevel: 45,
        voltage: 3.71,
        channelUtil: null,
        airUtilTx: null,
        uptimeSeconds: null,
      },
    });
  });

  it("a node without a position yields no position event", () => {
    const events = decode(nodeInfoFor(KAYAK) ?? (handshake[0] as FromRadio));
    expect(events.map((e) => e.type)).toEqual(["radio.node", "radio.telemetry"]);
  });

  it("an environment sensor's TELEMETRY_APP broadcast yields environment metrics", () => {
    const frame = handshake.find((m) => isPort(m, Portnums.PortNum.TELEMETRY_APP));
    if (!frame) throw new Error("no environment telemetry frame");
    expect(decode(frame)).toEqual([
      {
        type: "radio.telemetry",
        payload: {
          report: {
            connectionId: 1,
            nodeNum: GARAGE,
            time: RECORDED_AT_MS - 600_000,
            kind: "environment",
            environment: { temperature: 22.4, humidity: 61, pressure: 1013.2 },
            metrics: { temperature: 22.4, relative_humidity: 61, barometric_pressure: 1013.2 },
          },
        },
      },
    ]);
  });

  it("a device TELEMETRY_APP packet yields device metrics at the report's own time", async () => {
    const frame = await next(() =>
      node.injectTelemetry(RIDGE, {
        time: 1_799_999_000,
        variant: { case: "deviceMetrics", value: { batteryLevel: 64, voltage: 3.88 } },
      }),
    );
    expect(ofType(decode(frame), "radio.telemetry")[0]?.payload.report).toEqual({
      connectionId: 1,
      nodeNum: RIDGE,
      time: 1_799_999_000_000,
      kind: "device",
      device: {
        batteryLevel: 64,
        voltage: 3.88,
        channelUtil: null,
        airUtilTx: null,
        uptimeSeconds: null,
      },
      metrics: { battery_level: 64, voltage: 3.88 },
    });
  });

  it("a POSITION_APP packet yields a position; one without a fix is ignored", async () => {
    const withFix = await next(() =>
      node.injectPosition(TRAIL, {
        latitudeI: 475900000,
        longitudeI: -1221000000,
        precisionBits: 16,
      }),
    );
    expect(ofType(decode(withFix), "radio.position")[0]?.payload.position).toEqual({
      connectionId: 1,
      nodeNum: TRAIL,
      lat: 47.59,
      lon: -122.1,
      altitude: null,
      precisionBits: 16,
      time: RECORDED_AT_MS,
    });

    const noFix = await next(() => node.injectPosition(TRAIL, { latitudeI: 0, longitudeI: 0 }));
    expect(decodeFromRadio(noFix, ctx)).toEqual({ events: [], ignored: "position without a fix" });
  });

  it("power-monitor and air-quality reports keep every field under its protobuf name", async () => {
    const power = await next(() =>
      node.injectTelemetry(RIDGE, {
        time: 1_799_999_000,
        variant: { case: "powerMetrics", value: { ch1Voltage: 12.6, ch1Current: 250 } },
      }),
    );
    expect(ofType(decode(power), "radio.telemetry")[0]?.payload.report).toEqual({
      connectionId: 1,
      nodeNum: RIDGE,
      time: 1_799_999_000_000,
      kind: "power",
      metrics: { ch1_voltage: 12.6, ch1_current: 250 },
    });
    const air = await next(() =>
      node.injectTelemetry(RIDGE, {
        time: 1_799_999_000,
        variant: { case: "airQualityMetrics", value: { pm25Standard: 12, co2: 640 } },
      }),
    );
    expect(ofType(decode(air), "radio.telemetry")[0]?.payload.report).toMatchObject({
      kind: "air_quality",
      metrics: { pm25_standard: 12, co2: 640 },
    });
  });

  it("other telemetry variants are ignored with a reason", async () => {
    const frame = await next(() =>
      node.injectTelemetry(RIDGE, { variant: { case: "localStats", value: {} } }),
    );
    expect(decodeFromRadio(frame, ctx)).toEqual({ events: [], ignored: "telemetry localStats" });
  });

  it("nodeHeard records RSSI alongside SNR", async () => {
    const frame = await next(() =>
      node.injectText(RIDGE, { channel: 0 }, "hi", { rxRssi: -88, rxSnr: 5 }),
    );
    expect(nodeHeard(frame, ctx)?.payload).toMatchObject({
      update: { num: RIDGE, snr: 5, rssi: -88 },
    });
  });
});
