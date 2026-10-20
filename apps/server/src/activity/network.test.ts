import { fixtures, type MeshNode } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../db/database.js";
import { setMyNodeNum, upsertNode } from "../db/repositories.js";
import { packetStats } from "../db/schema.js";
import { openTestDatabase } from "../db/test-db.js";
import { Hub } from "../events/events.js";
import { silentLogger } from "../logger.js";
import { attachNetworkStats, buildTopology } from "./network.js";
import { buildTraffic, nodeHistory } from "./traffic.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;
const GARAGE = 0x5e6f7081;
const FAR = 0x22334455;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

let handle: DatabaseHandle;
let hub: Hub;
let detach: () => void;
const now = 1_800_000_000_000;

function node(num: number, lastHeard: number | null, hopsAway: number | null, snr: number | null) {
  const n: MeshNode = {
    ...fixtures.node,
    num,
    id: `!${num.toString(16).padStart(8, "0")}`,
    lastHeard,
    hopsAway,
    snr,
  };
  upsertNode(handle.db, n);
}

const packet = (from: number, port: string, at = now) => {
  hub.publish("radio.packet", { connectionId: 1, at, from, port });
};

beforeEach(() => {
  handle = openTestDatabase();
  hub = new Hub(silentLogger);
  setMyNodeNum(handle.db, 1, ME);
  detach = attachNetworkStats(hub, handle.db);
});

afterEach(() => {
  detach();
  handle.close();
});

describe("packet statistics", () => {
  it("counts packets per minute, node and port, but not my own node's", () => {
    packet(RIDGE, "TEXT_MESSAGE_APP");
    packet(RIDGE, "TEXT_MESSAGE_APP", now + 10_000);
    packet(RIDGE, "POSITION_APP");
    packet(TRAIL, "ENCRYPTED");
    packet(ME, "TELEMETRY_APP");
    const rows = handle.db.select().from(packetStats).all();
    const minute = Math.floor(now / 60_000) * 60_000;
    expect(rows.map((r) => [r.nodeNum, r.port, r.count, r.minute]).sort()).toEqual(
      [
        [RIDGE, "POSITION_APP", 1, minute],
        [RIDGE, "TEXT_MESSAGE_APP", 2, minute],
        [TRAIL, "ENCRYPTED", 1, minute],
      ].sort(),
    );
  });

  it("feeds the traffic buckets, port totals and top nodes", () => {
    for (let i = 0; i < 3; i++) packet(RIDGE, "TEXT_MESSAGE_APP", now - i * 60_000);
    packet(TRAIL, "POSITION_APP", now - 30 * 60_000);
    packet(TRAIL, "POSITION_APP", now - 2 * DAY); // outside 24 h
    const traffic = buildTraffic(handle.db, 1, ME, "24h", now);
    expect(traffic.buckets.reduce((n, b) => n + b.packets, 0)).toBe(4);
    const last = traffic.buckets.at(-1);
    expect(last?.packetsByPort.TEXT_MESSAGE_APP).toBeGreaterThan(0);
    expect(traffic.ports).toEqual([
      { port: "TEXT_MESSAGE_APP", packets: 3 },
      { port: "POSITION_APP", packets: 1 },
    ]);
    expect(traffic.topNodes).toEqual([
      { num: RIDGE, packets: 3 },
      { num: TRAIL, packets: 1 },
    ]);
  });

  it("gives a node's packets per hour in its history", () => {
    node(RIDGE, now, 0, 5);
    packet(RIDGE, "TEXT_MESSAGE_APP", now); // the current hour: the last bucket
    packet(RIDGE, "TEXT_MESSAGE_APP", now - 3 * HOUR);
    packet(TRAIL, "TEXT_MESSAGE_APP", now);
    const { heard } = nodeHistory(handle.db, 1, RIDGE, "24h", now);
    expect(heard.bucketMs).toBe(HOUR);
    expect(heard.buckets).toHaveLength(24);
    expect(heard.buckets.reduce((n, b) => n + b.packets, 0)).toBe(2);
    expect(heard.buckets.at(-1)?.packets).toBe(1);
  });
});

describe("topology", () => {
  beforeEach(() => {
    node(ME, now, 0, 0);
    node(RIDGE, now - HOUR, 0, 6.5); // heard directly
    node(TRAIL, now - 2 * HOUR, 1, -3); // one hop: no direct link
    node(GARAGE, now - HOUR, 2, 1);
    node(FAR, now - 3 * DAY, 0, 9); // outside the window
  });

  const neighbors = (reporter: number, list: { num: number; snr: number }[], time = now) => {
    hub.publish("radio.neighbors", { connectionId: 1, reporter, time, neighbors: list });
  };

  it("has direct links only for nodes whose last packet came with 0 hops", () => {
    const topology = buildTopology(handle.db, 1, DAY, now);
    expect(topology.myNodeNum).toBe(ME);
    expect(topology.nodes.map((n) => n.num).sort()).toEqual([RIDGE, TRAIL, GARAGE].sort());
    expect(topology.links).toEqual([
      { kind: "direct", from: ME, to: RIDGE, snr: 6.5, time: now - HOUR },
    ]);
  });

  it("adds reported links among shown nodes; a new report replaces the old one", () => {
    neighbors(RIDGE, [
      { num: TRAIL, snr: -2.25 },
      { num: FAR, snr: 3 }, // not heard within the window: dropped
    ]);
    neighbors(GARAGE, [{ num: TRAIL, snr: 1.5 }]);
    let links = buildTopology(handle.db, 1, DAY, now).links.filter((l) => l.kind === "reported");
    expect(links.map((l) => [l.from, l.to, l.snr]).sort()).toEqual(
      [
        [RIDGE, TRAIL, -2.25],
        [GARAGE, TRAIL, 1.5],
      ].sort(),
    );

    neighbors(RIDGE, [{ num: GARAGE, snr: 0.5 }]);
    links = buildTopology(handle.db, 1, DAY, now).links.filter((l) => l.kind === "reported");
    expect(links.map((l) => [l.from, l.to]).sort()).toEqual(
      [
        [RIDGE, GARAGE],
        [GARAGE, TRAIL],
      ].sort(),
    );
  });

  it("ignores reports older than the window", () => {
    neighbors(RIDGE, [{ num: TRAIL, snr: 1 }], now - 2 * DAY);
    expect(
      buildTopology(handle.db, 1, DAY, now).links.filter((l) => l.kind === "reported"),
    ).toEqual([]);
  });
});
