import { fixtures, type DashboardDTO, type ServerMessage } from "@meshterm/shared";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { scenarioDashboard } from "../test/scenario.js";
import { applyServerMessage } from "./apply.js";
import { appendSpark, SPARK_BUCKET_MS } from "./dashboard-cache.js";
import { queryKeys } from "./keys.js";
import { resetLiveStore, useLiveStore } from "./store.js";

const NOW = 1_800_000_000_000;
const RIDGE = 195939070;
const KAYAK = 860116326;
const UNKNOWN = 0x12345678;

let qc: QueryClient;
const key = queryKeys.dashboard(1);
const dashboard = () => qc.getQueryData<DashboardDTO>(key) as DashboardDTO;
const card = (num: number) => dashboard().nodes.find((c) => c.num === num);
const send = (message: ServerMessage) => {
  applyServerMessage(qc, message, NOW);
};

beforeEach(() => {
  qc = new QueryClient();
  resetLiveStore();
  useLiveStore.getState().setConnectionId(1);
  qc.setQueryData(key, scenarioDashboard("dashboard", NOW));
});

describe("dashboard cache patches", () => {
  it("node.upsert updates the card's node fields and the last packet time", () => {
    const before = card(RIDGE);
    send({
      type: "node.upsert",
      node: {
        ...fixtures.node,
        num: RIDGE,
        id: "!0badcafe",
        longName: "Ridge Repeater 2",
        lastHeard: NOW - 1000,
        snr: 3.5,
        hopsAway: 0,
        isFavorite: false,
      },
    });
    expect(card(RIDGE)).toMatchObject({
      longName: "Ridge Repeater 2",
      lastHeard: NOW - 1000,
      snr: 3.5,
      isFavorite: false,
      // Untouched: telemetry and position stay.
      device: before?.device,
      position: before?.position,
    });
    expect(dashboard().summary.lastPacketAt).toBe(NOW - 1000);
  });

  it("node.upsert for a node not on the dashboard adds a card without data", () => {
    send({
      type: "node.upsert",
      node: { ...fixtures.node, num: UNKNOWN, id: "!12345678", lastHeard: NOW },
    });
    expect(card(UNKNOWN)).toMatchObject({
      isSelf: false,
      position: null,
      device: null,
      environment: null,
      batterySpark: [],
    });
  });

  it("telemetry.new (device) merges metrics and appends a spark point", () => {
    send({
      type: "telemetry.new",
      telemetry: {
        connectionId: 1,
        nodeNum: KAYAK,
        time: NOW,
        kind: "device",
        device: {
          batteryLevel: 7,
          voltage: null,
          channelUtil: 4.5,
          airUtilTx: null,
          uptimeSeconds: null,
        },
      },
    });
    expect(card(KAYAK)?.device).toEqual({
      batteryLevel: 7,
      voltage: 3.41, // kept: the report didn't include it
      channelUtil: 4.5,
      airUtilTx: null,
      uptimeSeconds: null,
      time: NOW,
    });
    expect(card(KAYAK)?.batterySpark).toEqual([[NOW, 7]]);
  });

  it("telemetry.new (environment) sets the environment row", () => {
    send({
      type: "telemetry.new",
      telemetry: {
        connectionId: 1,
        nodeNum: RIDGE,
        time: NOW,
        kind: "environment",
        environment: { temperature: 5.5, humidity: null, pressure: 990 },
      },
    });
    expect(card(RIDGE)?.environment).toEqual({
      temperature: 5.5,
      humidity: null,
      pressure: 990,
      time: NOW,
    });
  });

  it("ignores reports older than what the card shows", () => {
    const before = dashboard();
    const ridge = card(RIDGE);
    send({
      type: "telemetry.new",
      telemetry: {
        connectionId: 1,
        nodeNum: RIDGE,
        time: (ridge?.device?.time ?? 0) - 60_000,
        kind: "device",
        device: {
          batteryLevel: 50,
          voltage: null,
          channelUtil: null,
          airUtilTx: null,
          uptimeSeconds: null,
        },
      },
    });
    // The spark still takes it only if it's in order; it isn't (it's before the last point? none yet).
    expect(card(RIDGE)?.device).toEqual(ridge?.device);
    send({
      type: "position.new",
      position: {
        connectionId: 1,
        nodeNum: RIDGE,
        lat: 1,
        lon: 1,
        altitude: null,
        precisionBits: null,
        time: (ridge?.position?.time ?? 0) - 60_000,
      },
    });
    expect(card(RIDGE)?.position).toEqual(ridge?.position);
    expect(dashboard().summary).toBe(before.summary);
  });

  it("position.new moves the card's position", () => {
    send({
      type: "position.new",
      position: {
        connectionId: 1,
        nodeNum: KAYAK,
        lat: 47.61,
        lon: -122.35,
        altitude: 3,
        precisionBits: 15,
        time: NOW,
      },
    });
    expect(card(KAYAK)?.position).toEqual({
      lat: 47.61,
      lon: -122.35,
      alt: 3,
      precisionBits: 15,
      time: NOW,
    });
  });

  it("ignores telemetry and positions for nodes the dashboard doesn't know", () => {
    const before = dashboard();
    send({
      type: "position.new",
      position: {
        connectionId: 1,
        nodeNum: UNKNOWN,
        lat: 1,
        lon: 1,
        altitude: null,
        precisionBits: null,
        time: NOW,
      },
    });
    send({
      type: "telemetry.new",
      telemetry: {
        connectionId: 1,
        nodeNum: UNKNOWN,
        time: NOW,
        kind: "environment",
        environment: { temperature: 1, humidity: null, pressure: null },
      },
    });
    expect(dashboard()).toBe(before);
  });

  it("events for another connection leave this dashboard alone", () => {
    const before = dashboard();
    send({
      type: "connection.state",
      connectionId: 2,
      state: "reconnecting",
      previous: null,
      reason: null,
    });
    send({
      type: "node.upsert",
      node: { ...fixtures.node, connectionId: 2, num: RIDGE, longName: "Elsewhere" },
    });
    expect(dashboard()).toBe(before);
  });

  it("connection.state updates the summary and connected-since", () => {
    send({
      type: "connection.state",
      connectionId: 1,
      state: "reconnecting",
      previous: null,
      reason: null,
    });
    expect(dashboard().summary).toMatchObject({
      connectionState: "reconnecting",
      connectedSince: null,
    });
    send({
      type: "connection.state",
      connectionId: 1,
      state: "connected",
      previous: null,
      reason: null,
    });
    expect(dashboard().summary).toMatchObject({
      connectionState: "connected",
      connectedSince: NOW,
    });
  });

  it("message.new counts toward messages (24 h); inbound ones move the last packet", () => {
    send({
      type: "message.new",
      message: { ...fixtures.inboundMessage, rxTime: NOW - 500 },
    });
    expect(dashboard().summary).toMatchObject({ messages24h: 1, lastPacketAt: NOW - 500 });
  });

  it("a reconnect snapshot refetches the dashboard; the first snapshot doesn't", async () => {
    const snapshot: ServerMessage = {
      type: "snapshot",
      connectionId: 1,
      state: "connected",
      myNodeNum: null,
      nodes: [],
      channels: [],
      channelMessages: [],
      dmMessages: [],
    };
    send(snapshot);
    expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
    send(snapshot);
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    await qc.cancelQueries();
  });
});

describe("appendSpark", () => {
  const t0 = Math.floor(NOW / SPARK_BUCKET_MS) * SPARK_BUCKET_MS;

  it("replaces the point in the same 30-min bucket and appends in a new one", () => {
    let spark = appendSpark([], t0 + 1000, 80);
    spark = appendSpark(spark, t0 + 2000, 79);
    expect(spark).toEqual([[t0 + 2000, 79]]);
    spark = appendSpark(spark, t0 + SPARK_BUCKET_MS, 78);
    expect(spark).toEqual([
      [t0 + 2000, 79],
      [t0 + SPARK_BUCKET_MS, 78],
    ]);
  });

  it("drops points older than 24 h, keeps at most 48, and ignores out-of-order points", () => {
    const full = Array.from(
      { length: 48 },
      (_, i) => [t0 + i * SPARK_BUCKET_MS, 50] as [number, number],
    );
    const next = appendSpark(full, t0 + 48 * SPARK_BUCKET_MS, 49);
    expect(next).toHaveLength(48);
    expect(next[0]?.[0]).toBe(t0 + SPARK_BUCKET_MS);
    expect(appendSpark(next, t0, 10)).toBe(next);
  });
});
