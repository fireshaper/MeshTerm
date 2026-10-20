import { randomUUID } from "node:crypto";
import { fixtures } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../db/database.js";
import {
  getMessage,
  getMyNodeNum,
  getNode,
  insertMessage,
  listChannels,
} from "../db/repositories.js";
import { openTestDatabase } from "../db/test-db.js";
import { Hub, type PublicEvents } from "./events.js";
import { attachPersistence, classifyDm, mergeNode } from "./persistence.js";

const RIDGE = 0x0badcafe;

let handle: DatabaseHandle;
let hub: Hub;
let published: { type: string; payload: unknown }[];

beforeEach(() => {
  handle = openTestDatabase();
  hub = new Hub();
  attachPersistence(hub, handle.db);
  published = [];
  hub.subscribeAll((e) => {
    if (!e.type.startsWith("radio.")) published.push(e);
  });
});

afterEach(() => {
  handle.close();
});

const ofType = <K extends keyof PublicEvents>(type: K) =>
  published.filter((e) => e.type === type).map((e) => e.payload as PublicEvents[K]);

describe("mergeNode", () => {
  const stored = { ...fixtures.node, lastHeard: 10_000, snr: 5, hopsAway: 1 };

  it("starts a never-seen node from defaults", () => {
    expect(mergeNode(null, { num: RIDGE, lastHeard: 1 }, 1)).toEqual({
      connectionId: 1,
      num: RIDGE,
      id: "!0badcafe",
      longName: "",
      shortName: "",
      hwModel: null,
      role: null,
      lastHeard: 1,
      snr: null,
      hopsAway: null,
      isFavorite: false,
    });
  });

  it("keeps fields the update doesn't mention", () => {
    expect(mergeNode(stored, { num: stored.num, longName: "New" }, 1)).toEqual({
      ...stored,
      longName: "New",
    });
  });

  it("never moves lastHeard backwards, and ignores stale signal values", () => {
    const merged = mergeNode(
      stored,
      { num: stored.num, lastHeard: 5_000, snr: -20, hopsAway: 3 },
      1,
    );
    expect(merged).toMatchObject({ lastHeard: 10_000, snr: 5, hopsAway: 1 });
  });

  it("takes fresher signal values", () => {
    const merged = mergeNode(
      stored,
      { num: stored.num, lastHeard: 20_000, snr: -1, hopsAway: 2 },
      1,
    );
    expect(merged).toMatchObject({ lastHeard: 20_000, snr: -1, hopsAway: 2 });
  });
});

describe("classifyDm", () => {
  const me = fixtures.inboundMessage.toNum;
  it("files a DM from our own node under its recipient, as outgoing", () => {
    const echo = { ...fixtures.inboundMessage, fromNum: me, toNum: 0x0badcafe, peer: me };
    expect(classifyDm(echo, me)).toMatchObject({ peer: 0x0badcafe, direction: "out" });
  });
  it("leaves incoming DMs, broadcasts and unknown node numbers alone", () => {
    expect(classifyDm(fixtures.inboundMessage, me)).toBe(fixtures.inboundMessage);
    expect(classifyDm(fixtures.outboundMessage, me)).toBe(fixtures.outboundMessage);
    expect(classifyDm(fixtures.inboundMessage, null)).toBe(fixtures.inboundMessage);
  });
});

describe("attachPersistence", () => {
  it("stores my node number", () => {
    hub.publish("radio.myInfo", { connectionId: 1, myNodeNum: 0xa1b2c3d4 });
    expect(getMyNodeNum(handle.db, 1)).toBe(0xa1b2c3d4);
  });

  it("stores node updates and publishes the merged node", () => {
    hub.publish("radio.node", { connectionId: 1, update: { num: RIDGE, longName: "Ridge" } });
    hub.publish("radio.node", {
      connectionId: 1,
      update: { num: RIDGE, lastHeard: 1_000, snr: 3 },
    });
    const stored = getNode(handle.db, 1, RIDGE);
    expect(stored).toMatchObject({ longName: "Ridge", lastHeard: 1_000, snr: 3 });
    expect(ofType("node.upsert").at(-1)?.node).toEqual(stored);
  });

  it("stores channels and publishes channel.upsert", () => {
    hub.publish("radio.channel", { channel: fixtures.channel });
    expect(listChannels(handle.db, 1)).toEqual([fixtures.channel]);
    expect(ofType("channel.upsert")).toEqual([{ channel: fixtures.channel }]);
  });

  it("publishes message.new once per packet, not for duplicates", () => {
    const first = { ...fixtures.inboundMessage, id: randomUUID() };
    hub.publish("radio.text", { message: first });
    hub.publish("radio.text", { message: { ...first, id: randomUUID() } });
    expect(ofType("message.new")).toEqual([{ message: first }]);
  });

  it("turns a routing reply into a status update on our message", () => {
    const out = { ...fixtures.outboundMessage, id: randomUUID(), status: "sent" as const };
    insertMessage(handle.db, out);
    hub.publish("radio.routing", {
      connectionId: 1,
      requestId: out.packetId,
      status: "acked",
      error: null,
    });
    expect(getMessage(handle.db, out.id)?.status).toBe("acked");
    expect(ofType("message.status")).toEqual([
      { connectionId: 1, messageId: out.id, status: "acked", errorReason: null },
    ]);

    // A late error after the ACK changes nothing.
    hub.publish("radio.routing", {
      connectionId: 1,
      requestId: out.packetId,
      status: "failed",
      error: "MAX_RETRANSMIT",
    });
    expect(getMessage(handle.db, out.id)?.status).toBe("acked");
    expect(ofType("message.status")).toHaveLength(1);
  });

  it("ignores routing replies for packets we didn't send", () => {
    hub.publish("radio.routing", { connectionId: 1, requestId: 999, status: "acked", error: null });
    expect(ofType("message.status")).toEqual([]);
  });
});
