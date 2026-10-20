import { fixtures, type Message, type ServerMessageOf } from "@meshterm/shared";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { applyServerMessage, insertMessage } from "./apply.js";
import { queryKeys, type ConversationData } from "./keys.js";
import { resetLiveStore, useLiveStore } from "./store.js";

const RIDGE = 0x0badcafe;
const ME = 0xa1b2c3d4;
let n = 0;

function msg(overrides: Partial<Message>): Message {
  n++;
  return {
    ...fixtures.inboundMessage,
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    packetId: n,
    ...overrides,
  };
}

const channelMsg = (rxTime: number, channelIndex = 0) =>
  msg({ toNum: 0xffff_ffff, peer: null, channelIndex, rxTime });

function snapshot(
  overrides: Partial<ServerMessageOf<"snapshot">> = {},
): ServerMessageOf<"snapshot"> {
  return {
    type: "snapshot",
    connectionId: 1,
    state: "connected",
    myNodeNum: ME,
    nodes: [fixtures.node, { ...fixtures.node, num: RIDGE, id: "!0badcafe", shortName: "RDG" }],
    channels: [
      fixtures.channel,
      { ...fixtures.channel, index: 1, name: "Friends", role: "SECONDARY" },
    ],
    channelMessages: [
      { channelIndex: 0, messages: [channelMsg(1_000), channelMsg(2_000)] },
      { channelIndex: 1, messages: [] },
    ],
    dmMessages: [
      { peer: RIDGE, messages: [msg({ fromNum: RIDGE, toNum: ME, peer: RIDGE, rxTime: 500 })] },
    ],
    ...overrides,
  };
}

let qc: QueryClient;
const conversation = (key: ReturnType<typeof queryKeys.messages>) =>
  qc.getQueryData<ConversationData>(key);
const channel0 = queryKeys.messages(1, { channel: 0 });

beforeEach(() => {
  qc = new QueryClient();
  resetLiveStore();
  useLiveStore.getState().setConnectionId(1);
});

describe("applyServerMessage", () => {
  it("a snapshot seeds nodes, channels, conversations and the store", () => {
    applyServerMessage(qc, snapshot());
    expect(qc.getQueryData(queryKeys.nodes(1))).toHaveLength(2);
    expect(qc.getQueryData(queryKeys.channels(1))).toHaveLength(2);
    expect(conversation(channel0)?.messages.map((m) => m.rxTime)).toEqual([1_000, 2_000]);
    expect(conversation(channel0)?.cursor).toBeNull(); // fewer than a full page
    expect(conversation(queryKeys.messages(1, { peer: RIDGE }))?.messages).toHaveLength(1);
    expect(useLiveStore.getState()).toMatchObject({ nodeState: "connected", myNodeNum: ME });
  });

  it("a full snapshot page gets a cursor at its oldest message", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => channelMsg(10_000 + i));
    applyServerMessage(qc, snapshot({ channelMessages: [{ channelIndex: 0, messages: fifty }] }));
    expect(conversation(channel0)?.cursor).toBe(`10000_${fifty[0]?.id ?? ""}`);
  });

  it("a new snapshot replaces what was cached, including conversations it doesn't list", () => {
    applyServerMessage(qc, snapshot());
    applyServerMessage(qc, snapshot({ channelMessages: [], dmMessages: [] }));
    expect(conversation(channel0)).toEqual({ messages: [], cursor: null });
    expect(conversation(queryKeys.messages(1, { peer: RIDGE }))).toEqual({
      messages: [],
      cursor: null,
    });
  });

  it("node.upsert replaces an existing node or adds a new one", () => {
    applyServerMessage(qc, snapshot());
    applyServerMessage(qc, {
      type: "node.upsert",
      node: { ...fixtures.node, num: RIDGE, id: "!0badcafe", shortName: "NEW" },
    });
    applyServerMessage(qc, {
      type: "node.upsert",
      node: { ...fixtures.node, num: 7, id: "!00000007" },
    });
    const nodes = qc.getQueryData<{ num: number; shortName: string }[]>(queryKeys.nodes(1)) ?? [];
    expect(nodes.map((x) => x.num)).toEqual([fixtures.node.num, RIDGE, 7]);
    expect(nodes.find((x) => x.num === RIDGE)?.shortName).toBe("NEW");
  });

  it("message.new appends to the right conversation once, in order", () => {
    applyServerMessage(qc, snapshot());
    const late = channelMsg(3_000);
    const early = channelMsg(1_500);
    const dm = msg({ fromNum: RIDGE, toNum: ME, peer: RIDGE, rxTime: 4_000 });
    for (const m of [late, late, early, dm])
      applyServerMessage(qc, { type: "message.new", message: m });
    expect(conversation(channel0)?.messages.map((m) => m.rxTime)).toEqual([
      1_000, 1_500, 2_000, 3_000,
    ]);
    expect(
      conversation(queryKeys.messages(1, { peer: RIDGE }))?.messages.map((m) => m.rxTime),
    ).toEqual([500, 4_000]);
    // Channel 1 got nothing.
    expect(conversation(queryKeys.messages(1, { channel: 1 }))?.messages).toEqual([]);
  });

  it("message.new for an uncached conversation is left for its first fetch", () => {
    applyServerMessage(qc, { type: "message.new", message: channelMsg(1, 5) });
    expect(conversation(queryKeys.messages(1, { channel: 5 }))).toBeUndefined();
  });

  it("message.status updates one message, and an unknown id is a no-op", () => {
    const out = msg({
      direction: "out",
      status: "queued",
      fromNum: ME,
      toNum: 0xffff_ffff,
      peer: null,
      rxTime: 2_500,
    });
    applyServerMessage(qc, snapshot());
    applyServerMessage(qc, { type: "message.new", message: out });
    applyServerMessage(qc, {
      type: "message.status",
      connectionId: 1,
      messageId: out.id,
      status: "acked",
      errorReason: null,
    });
    expect(conversation(channel0)?.messages.find((m) => m.id === out.id)?.status).toBe("acked");

    const before = conversation(channel0);
    applyServerMessage(qc, {
      type: "message.status",
      connectionId: 1,
      messageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      status: "failed",
      errorReason: "NO_RESPONSE",
    });
    expect(conversation(channel0)).toBe(before);
  });

  it("connection.state updates the store for the active connection only", () => {
    applyServerMessage(qc, {
      type: "connection.state",
      connectionId: 1,
      state: "reconnecting",
      previous: "connected",
      reason: "x",
    });
    expect(useLiveStore.getState().nodeState).toBe("reconnecting");
    applyServerMessage(qc, {
      type: "connection.state",
      connectionId: 2,
      state: "connected",
      previous: null,
      reason: null,
    });
    expect(useLiveStore.getState().nodeState).toBe("reconnecting");
  });
});

describe("insertMessage", () => {
  it("returns the same array for a duplicate id", () => {
    const a = channelMsg(1);
    const list = [a];
    expect(insertMessage(list, { ...a })).toBe(list);
  });
});
