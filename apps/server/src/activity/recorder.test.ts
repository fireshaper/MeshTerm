import { fixtures, type ActivityEvent, type MeshNode } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../db/database.js";
import { setMyNodeNum, upsertNode } from "../db/repositories.js";
import { openTestDatabase } from "../db/test-db.js";
import { Hub } from "../events/events.js";
import { silentLogger } from "../logger.js";
import { attachActivity, listActivity, powerState } from "./recorder.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const NEW = 0x12345678;
const HOUR = 3600_000;

let handle: DatabaseHandle;
let hub: Hub;
let now: number;
let published: ActivityEvent[];
let detach: () => void;

function node(num: number, lastHeard: number | null, extra: Partial<MeshNode> = {}): MeshNode {
  return {
    ...fixtures.node,
    num,
    id: `!${num.toString(16).padStart(8, "0")}`,
    lastHeard,
    ...extra,
  };
}

function setup(options: { maxRows?: number } = {}) {
  hub = new Hub(silentLogger);
  published = [];
  hub.subscribe("activity.new", ({ activity }) => {
    published.push(activity);
  });
  detach = attachActivity(hub, handle.db, { now: () => now, ...options });
}

const state = (state: "connected" | "configuring" | "reconnecting", previous: string | null) => {
  hub.publish("connection.state", {
    connectionId: 1,
    state,
    previous: previous as never,
    reason: state === "reconnecting" ? "link closed (peer-closed)" : "test",
  });
};

beforeEach(() => {
  handle = openTestDatabase();
  now = 1_800_000_000_000;
  setMyNodeNum(handle.db, 1, ME);
  upsertNode(handle.db, node(RIDGE, now - 30 * HOUR));
  upsertNode(handle.db, node(ME, now));
});

afterEach(() => {
  detach();
  handle.close();
});

describe("activity recorder", () => {
  it("reports a packet to my node that couldn't be decrypted, once per sender per 10 min", () => {
    setup();
    state("connected", "configuring");
    const undecryptable = (from: number, to: number) => {
      hub.publish("radio.undecryptable", { connectionId: 1, from, to, channel: 0x5a });
    };
    undecryptable(RIDGE, ME);
    undecryptable(RIDGE, ME); // the same sender again right away: no new entry
    undecryptable(RIDGE, 0xffff_ffff); // someone else's channel broadcast: normal, not news
    undecryptable(NEW, 0x22222222); // a DM between other nodes
    expect(published.map((e) => [e.kind, e.nodeNum, e.value])).toEqual([
      ["message.undecryptable", RIDGE, 0x5a],
    ]);
    now += 11 * 60_000;
    undecryptable(RIDGE, ME);
    expect(published).toHaveLength(2);
  });

  it("records a lost link and its restoration with the downtime", () => {
    setup();
    state("configuring", "connecting");
    state("connected", "configuring");
    expect(published).toEqual([]);
    state("reconnecting", "connected");
    now += 90_000;
    state("configuring", "connecting");
    state("connected", "configuring");
    expect(published.map((e) => [e.kind, e.value, e.detail])).toEqual([
      ["connection.lost", null, "link closed (peer-closed)"],
      ["connection.restored", 90_000, null],
    ]);
  });

  it("ignores node updates during the handshake, then notes new and returning nodes", () => {
    setup();
    state("configuring", "connecting");
    // The handshake replays the node DB, including a node we've never seen.
    hub.publish("node.upsert", { node: node(NEW, now - HOUR) });
    hub.publish("node.upsert", { node: node(RIDGE, now - HOUR) });
    expect(published).toEqual([]);

    state("connected", "configuring");
    hub.publish("node.upsert", { node: node(0x0000beef, now) });
    // Heard 1 h after the last time: under the 24 h stale threshold, not news.
    hub.publish("node.upsert", { node: node(RIDGE, now) });
    // My own node is never feed news.
    hub.publish("node.upsert", { node: node(ME, now + 1) });
    expect(published.map((e) => [e.kind, e.nodeNum])).toEqual([["node.new", 0x0000beef]]);

    // Quiet for 25 h, then heard again.
    hub.publish("node.upsert", { node: node(RIDGE, now + 25 * HOUR) });
    expect(published.at(-1)).toMatchObject({
      kind: "node.back",
      nodeNum: RIDGE,
      value: 25 * HOUR,
    });
  });

  it("notes power state changes, not every battery reading", () => {
    upsertNode(handle.db, node(RIDGE, now));
    setup();
    state("connected", "configuring");
    const report = (batteryLevel: number) => {
      hub.publish("telemetry.new", {
        telemetry: {
          connectionId: 1,
          nodeNum: RIDGE,
          time: now,
          kind: "device",
          device: {
            batteryLevel,
            voltage: null,
            channelUtil: null,
            airUtilTx: null,
            uptimeSeconds: null,
          },
        },
      });
    };
    report(60); // first known state: nothing to compare with
    report(55);
    report(19);
    report(18);
    report(9);
    report(101);
    expect(published.map((e) => [e.kind, e.detail, e.value])).toEqual([
      ["power.changed", "ok→low", 19],
      ["power.changed", "low→critical", 9],
      ["power.changed", "critical→external", 101],
    ]);
  });

  it("records messages with a preview and the channel for broadcasts", () => {
    setup();
    const long = "x".repeat(100);
    hub.publish("message.new", {
      message: { ...fixtures.inboundMessage, rxTime: now - 5, text: long },
    });
    hub.publish("message.new", {
      message: {
        ...fixtures.inboundMessage,
        id: "00000000-0000-4000-8000-000000000099",
        direction: "out",
        status: "queued",
        fromNum: ME,
        toNum: RIDGE,
        peer: RIDGE,
        text: "hi",
        rxTime: now,
      },
    });
    const [inbound, outbound] = published;
    expect(inbound).toMatchObject({
      kind: "message.in",
      nodeNum: fixtures.inboundMessage.fromNum,
      messageId: fixtures.inboundMessage.id,
      time: now - 5,
    });
    expect(inbound?.detail).toHaveLength(80);
    expect(inbound?.detail?.endsWith("…")).toBe(true);
    expect(outbound).toMatchObject({
      kind: "message.out",
      nodeNum: RIDGE,
      value: null,
      detail: "hi",
    });
  });

  it("keeps at most maxRows per connection, and a week", () => {
    setup({ maxRows: 10 });
    for (let i = 0; i < 100; i++) {
      hub.publish("message.new", {
        message: {
          ...fixtures.inboundMessage,
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          rxTime: now + i,
        },
      });
    }
    const page = listActivity(handle.db, 1, { limit: 200 });
    expect(page.events.length).toBeLessThanOrEqual(10 + 50);
    expect(page.events[0]?.time).toBe(now + 99);

    // A week later, the next prune drops everything older.
    now += 8 * 24 * HOUR;
    for (let i = 0; i < 50; i++) {
      hub.publish("message.new", {
        message: {
          ...fixtures.inboundMessage,
          id: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`,
          rxTime: now + i,
        },
      });
    }
    const after = listActivity(handle.db, 1, { limit: 200 }).events;
    expect(after.every((e) => e.time >= now)).toBe(true);
  });

  it("pages newest first with a before cursor", () => {
    setup();
    for (let i = 0; i < 5; i++) {
      hub.publish("message.new", {
        message: {
          ...fixtures.inboundMessage,
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          rxTime: now + i,
        },
      });
    }
    const first = listActivity(handle.db, 1, { limit: 2 });
    expect(first.events.map((e) => e.time)).toEqual([now + 4, now + 3]);
    const second = listActivity(handle.db, 1, { before: first.nextBefore, limit: 10 });
    expect(second.events.map((e) => e.time)).toEqual([now + 2, now + 1, now]);
    expect(second.nextBefore).toBeNull();
  });
});

describe("powerState", () => {
  it("uses the UI's bands", () => {
    expect([null, 101, 100, 20, 19, 10, 9].map(powerState)).toEqual([
      null,
      "external",
      "ok",
      "ok",
      "low",
      "low",
      "critical",
    ]);
  });
});
