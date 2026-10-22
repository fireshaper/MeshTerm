import { until } from "@meshterm/fake-node";
import type { Channel, ConversationsDTO, MeshNode, ServerMessage } from "@meshterm/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messages, nodes } from "../db/schema.js";
import { startTestApp, type TestApp } from "../test-app.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp();
});

afterEach(async () => {
  await t.close();
});

const get = async <T>(path: string) =>
  (await t.app.inject({ url: `/api/connections/1/${path}` })).json<T>();
const UNREAD_STATE = { lastReadRxTime: 0, muted: false, favorite: false, notifyLevel: "all" };
const count = () => t.app.meshterm.db.select().from(messages).all().length;

describe("GET /api/connections/:id/conversations", () => {
  it("lists channels (preset name for the unnamed primary) and DMs newest first", async () => {
    t.node.injectText(TRAIL, { to: ME }, "older dm");
    await until(() => count() === 1, 2_000);
    await new Promise((r) => setTimeout(r, 1_100)); // rx_time has 1 s resolution
    t.node.injectText(RIDGE, { to: ME }, "newer dm", { pkiEncrypted: true });
    t.node.injectText(RIDGE, { channel: 1 }, "hello friends");
    await until(() => count() === 3, 2_000);

    const dto = await get<ConversationsDTO>("conversations");
    expect(dto.channels).toEqual([
      {
        index: 0,
        name: "LongFast",
        role: "PRIMARY",
        encryption: "default",
        lastMessage: null,
        unread: 0,
        unreadMentions: 0,
        state: UNREAD_STATE,
      },
      {
        index: 1,
        name: "Friends",
        role: "SECONDARY",
        encryption: "custom",
        lastMessage: expect.objectContaining({ text: "hello friends", direction: "in" }) as unknown,
        unread: 1,
        unreadMentions: 0,
        state: UNREAD_STATE,
      },
    ]);
    expect(dto.dms.map((d) => [d.peer, d.lastMessage.text, d.lastMessage.pkiEncrypted])).toEqual([
      [RIDGE, "newer dm", true],
      [TRAIL, "older dm", false],
    ]);
  });

  it("is 404 for an unknown connection", async () => {
    const res = await t.app.inject({ url: "/api/connections/99/conversations" });
    expect(res.statusCode).toBe(404);
  });
});

describe("handshake metadata", () => {
  it("stores channel encryption kinds and which nodes have a public key, never the PSK", async () => {
    const channels = await get<Channel[]>("channels");
    expect(channels.map((c) => c.encryption)).toEqual(["default", "custom"]);
    expect(JSON.stringify(channels)).not.toContain("psk");
    const nodes = await get<MeshNode[]>("nodes");
    expect(nodes.find((n) => n.num === RIDGE)?.hasPublicKey).toBe(true);
    expect(nodes.find((n) => n.num === TRAIL)?.hasPublicKey).toBe(false);
  });
});

describe("read state (CR-003 N0)", () => {
  const post = (path: string, payload?: object) =>
    t.app.inject({
      method: "POST",
      url: `/api/connections/1/${path}`,
      ...(payload ? { payload } : {}),
    });
  const events: ServerMessage[] = [];
  beforeEach(() => {
    events.length = 0;
    t.app.meshterm.hub.subscribe("conversation.read", (p) => {
      events.push({ type: "conversation.read", ...p });
    });
    t.app.meshterm.hub.subscribe("conversation.updated", (p) => {
      events.push({ type: "conversation.updated", ...p });
    });
  });

  it("counts incoming messages after the read mark, not reactions or ignored nodes", async () => {
    t.node.injectText(RIDGE, { to: ME }, "one");
    t.node.injectText(RIDGE, { to: ME }, "two");
    t.node.injectText(RIDGE, { to: ME }, "👍", { emoji: true, replyId: 7 });
    t.node.injectText(RIDGE, { channel: 0 }, "on the primary");
    t.node.injectText(TRAIL, { channel: 0 }, "from an ignored node");
    await until(() => count() === 5, 2_000);
    t.app.meshterm.db.update(nodes).set({ isIgnored: true }).where(eq(nodes.num, TRAIL)).run();

    let dto = await get<ConversationsDTO>("conversations");
    expect(dto.dms.find((d) => d.peer === RIDGE)).toMatchObject({ unread: 2, ignored: false });
    expect(dto.channels.find((c) => c.index === 0)?.unread).toBe(1);

    const read = await post(`conversations/dm/${RIDGE}/read`);
    expect(read.statusCode, read.body).toBe(200);
    dto = await get<ConversationsDTO>("conversations");
    expect(dto.dms.find((d) => d.peer === RIDGE)?.unread).toBe(0);
    expect(events).toEqual([
      expect.objectContaining({ type: "conversation.read", kind: "dm", key: RIDGE }),
    ]);
    // A read mark never moves backwards.
    const back = await post(`conversations/dm/${RIDGE}/read`, { upTo: 1 });
    expect(back.json<{ lastReadRxTime: number }>().lastReadRxTime).toBeGreaterThan(1);
  });

  it("mutes and favorites; deleting a DM hides it until a newer message", async () => {
    t.node.injectText(RIDGE, { to: ME }, "before delete");
    await until(() => count() === 1, 2_000);
    const patch = await t.app.inject({
      method: "PATCH",
      url: "/api/connections/1/conversations/channel/1",
      payload: { muted: true, favorite: true },
    });
    expect(patch.json()).toMatchObject({ muted: true, favorite: true });
    const del = await t.app.inject({
      method: "DELETE",
      url: `/api/connections/1/conversations/dm/${RIDGE}`,
    });
    expect(del.statusCode).toBe(200);
    let dto = await get<ConversationsDTO>("conversations");
    expect(dto.channels.find((c) => c.index === 1)?.state).toMatchObject({
      muted: true,
      favorite: true,
    });
    expect(dto.dms).toEqual([]);
    const thread = await get<{ messages: unknown[] }>(`messages?peer=${RIDGE}`);
    expect(thread.messages).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["conversation.updated", "conversation.updated"]);

    await new Promise((r) => setTimeout(r, 1_100)); // rx_time has 1 s resolution
    t.node.injectText(RIDGE, { to: ME }, "after delete");
    await until(() => count() === 2, 2_000);
    dto = await get<ConversationsDTO>("conversations");
    expect(dto.dms.map((d) => [d.lastMessage.text, d.unread])).toEqual([["after delete", 1]]);
  });

  it("counts unread mentions for the user, with their keywords, and replies to us", async () => {
    await t.app.inject({
      method: "PATCH",
      url: "/api/me/notification-prefs",
      payload: { mentionKeywords: ["pancakes"] },
    });
    t.node.injectText(RIDGE, { channel: 1 }, "@MTB hello");
    t.node.injectText(RIDGE, { channel: 1 }, "pancakes at 8");
    t.node.injectText(RIDGE, { channel: 1 }, "nothing for you");
    await until(() => count() === 3, 2_000);
    const dto = await get<ConversationsDTO>("conversations");
    expect(dto.channels.find((c) => c.index === 1)).toMatchObject({ unread: 3, unreadMentions: 2 });
  });

  it("refuses bad keys and unknown connections", async () => {
    expect((await post("conversations/channel/9/read")).statusCode).toBe(400);
    expect((await post("conversations/group/1/read")).statusCode).toBe(400);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/connections/9/conversations/dm/5/read",
    });
    expect(res.statusCode).toBe(404);
  });
});
