import { randomUUID } from "node:crypto";
import { BROADCAST_NUM, fixtures, type Message } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle, Db } from "./database.js";
import {
  getConnection,
  getMessage,
  insertMessage,
  listChannelMessages,
  listChannels,
  listConnections,
  listDmMessages,
  listNodes,
  nextCursor,
  updateMessageStatus,
  upsertChannel,
  upsertNode,
} from "./repositories.js";
import { openTestDatabase } from "./test-db.js";

const ME = 0xa1b2c3d4;
const BOB = 0x0badcafe;
const CAROL = 0x1a2b3c4d;

let handle: DatabaseHandle;
let db: Db;
let nextPacketId = 1;

beforeEach(() => {
  handle = openTestDatabase();
  db = handle.db;
});

afterEach(() => {
  handle.close();
});

function message(overrides: Partial<Message>): Message {
  return {
    ...fixtures.inboundMessage,
    id: randomUUID(),
    packetId: nextPacketId++,
    ...overrides,
  };
}

const broadcast = (rxTime: number, channelIndex = 0) =>
  message({ fromNum: BOB, toNum: BROADCAST_NUM, peer: null, channelIndex, rxTime });

describe("connections", () => {
  it("lists connections and gets one by id", () => {
    expect(listConnections(db)).toEqual([fixtures.connection]);
    expect(getConnection(db, 1)).toEqual(fixtures.connection);
    expect(getConnection(db, 99)).toBeNull();
  });
});

describe("nodes", () => {
  it("upserts and lists nodes as shared MeshNode objects", () => {
    upsertNode(db, fixtures.node);
    expect(listNodes(db, 1)).toEqual([fixtures.node]);

    upsertNode(db, { ...fixtures.node, longName: "Renamed", snr: 1.5 });
    expect(listNodes(db, 1)).toEqual([{ ...fixtures.node, longName: "Renamed", snr: 1.5 }]);
  });

  it("orders by last heard, newest first, never-heard last", () => {
    upsertNode(db, { ...fixtures.node, num: 1, id: "!00000001", lastHeard: null });
    upsertNode(db, { ...fixtures.node, num: 2, id: "!00000002", lastHeard: 100 });
    upsertNode(db, { ...fixtures.node, num: 3, id: "!00000003", lastHeard: 300 });
    expect(listNodes(db, 1).map((n) => n.num)).toEqual([3, 2, 1]);
  });

  it("keeps connections apart", () => {
    upsertNode(db, fixtures.node);
    expect(listNodes(db, 2)).toEqual([]);
  });
});

describe("channels", () => {
  it("upserts and lists channels by index", () => {
    upsertChannel(db, { ...fixtures.channel, index: 1, name: "Friends", role: "SECONDARY" });
    upsertChannel(db, fixtures.channel);
    upsertChannel(db, { ...fixtures.channel, name: "Renamed" });
    expect(listChannels(db, 1)).toEqual([
      { ...fixtures.channel, name: "Renamed" },
      { connectionId: 1, index: 1, name: "Friends", role: "SECONDARY" },
    ]);
  });
});

describe("messages", () => {
  it("inserts, gets by id and updates status", () => {
    const out = { ...fixtures.outboundMessage, status: "queued" as const };
    expect(insertMessage(db, out)).toBe("inserted");
    expect(getMessage(db, out.id)).toEqual(out);

    expect(updateMessageStatus(db, out.id, "acked")).toBe(true);
    expect(getMessage(db, out.id)?.status).toBe("acked");
    expect(updateMessageStatus(db, randomUUID(), "acked")).toBe(false);
    expect(getMessage(db, randomUUID())).toBeNull();
  });

  it("pages 120 channel messages as 50, 50, 20 with no overlap, newest first", () => {
    // Three messages per second, like firmware rx_time, so pages split ties.
    const all = Array.from({ length: 120 }, (_, i) =>
      broadcast(1_000_000 + Math.floor(i / 3) * 1000),
    );
    for (const m of all) insertMessage(db, m);
    insertMessage(db, broadcast(9_999_999, 1)); // another channel

    const pages: Message[][] = [];
    let before = undefined as ReturnType<typeof nextCursor> | undefined;
    for (;;) {
      const page = listChannelMessages(db, 1, 0, { limit: 50, ...(before ? { before } : {}) });
      pages.push(page);
      before = nextCursor(page, 50);
      if (!before) break;
    }
    expect(pages.map((p) => p.length)).toEqual([50, 50, 20]);

    const ids = pages.flat().map((m) => m.id);
    expect(new Set(ids).size).toBe(120);
    expect(new Set(ids)).toEqual(new Set(all.map((m) => m.id)));
    const times = pages.flat().map((m) => m.rxTime);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("keeps DMs out of the channel list", () => {
    insertMessage(db, broadcast(1));
    insertMessage(db, message({ fromNum: BOB, toNum: ME, peer: BOB, channelIndex: 0, rxTime: 2 }));
    expect(listChannelMessages(db, 1, 0)).toHaveLength(1);
  });

  it("lists both directions of one DM conversation and nothing else", () => {
    const fromBob = message({ fromNum: BOB, toNum: ME, peer: BOB, rxTime: 1 });
    const toBob = message({
      fromNum: ME,
      toNum: BOB,
      peer: BOB,
      rxTime: 2,
      direction: "out",
      status: "sent",
    });
    insertMessage(db, fromBob);
    insertMessage(db, toBob);
    insertMessage(db, message({ fromNum: CAROL, toNum: ME, peer: CAROL, rxTime: 3 }));
    insertMessage(db, broadcast(4));

    expect(listDmMessages(db, 1, BOB).map((m) => m.id)).toEqual([toBob.id, fromBob.id]);
  });

  it("rejects a limit outside 1 to 200", () => {
    expect(() => listChannelMessages(db, 1, 0, { limit: 201 })).toThrow(RangeError);
    expect(() => listDmMessages(db, 1, BOB, { limit: 0 })).toThrow(RangeError);
    expect(listChannelMessages(db, 1, 0, { limit: 200 })).toEqual([]);
  });
});
