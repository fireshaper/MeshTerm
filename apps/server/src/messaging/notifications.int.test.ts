// CR-003 Phase N1 end to end: mention/reply/backlog flags when stored, the per-user
// `notify` hint on message.new, notification levels and the user's prefs.
import { until } from "@meshterm/fake-node";
import type {
  ConversationsDTO,
  Message,
  NotificationPrefsDTO,
  ServerMessageOf,
} from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messages } from "../db/schema.js";
import { startTestApp, type TestApp } from "../test-app.js";
import { WsTestClient } from "../ws/test-client.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;

let t: TestApp;
let ws: WsTestClient;

beforeEach(async () => {
  t = await startTestApp();
  await t.app.listen({ host: "127.0.0.1", port: 0 });
  await until(() => t.app.meshterm.connections.get(1)?.state === "connected", 5_000);
  ws = await WsTestClient.open(t.app);
  ws.send({ type: "subscribe", connectionId: 1 });
  await ws.next("snapshot");
});

afterEach(async () => {
  ws.socket.close();
  await t.close();
});

const stored = (text: string) =>
  t.app.meshterm.db
    .select()
    .from(messages)
    .all()
    .find((m) => m.text === text);

/** The message.new for this text, with its hint. */
async function arrived(text: string): Promise<ServerMessageOf<"message.new">> {
  await ws.waitFor(() => ws.ofType("message.new").some((m) => m.message.text === text));
  const event = ws.ofType("message.new").find((m) => m.message.text === text);
  if (!event) throw new Error(text);
  return event;
}

const patch = (url: string, payload: object) => t.app.inject({ method: "PATCH", url, payload });

describe("notify hints (CR-003 N1)", () => {
  it("a DM notifies; a channel message only when it names us", async () => {
    t.node.injectText(RIDGE, { to: ME }, "dm for you");
    expect((await arrived("dm for you")).notify).toEqual({
      level: "notify",
      reason: "dm",
      backlog: false,
    });
    t.node.injectText(RIDGE, { channel: 0 }, "hello everyone");
    expect((await arrived("hello everyone")).notify?.level).toBe("badge");
    // The scenario's own node is "MeshTerm Base" (MTB).
    t.node.injectText(RIDGE, { channel: 0 }, "@MTB are you on?");
    expect((await arrived("@MTB are you on?")).notify?.reason).toBe("mention");
    expect(stored("@MTB are you on?")?.mentionsMe).toBe(true);
    expect(stored("hello everyone")?.mentionsMe).toBe(false);
  });

  it("a reply to one of our messages notifies; a reaction to it shows in the app", async () => {
    const sent = await t.app.inject({
      method: "POST",
      url: "/api/connections/1/messages",
      payload: { text: "anyone heading out?", channel: 0 },
    });
    const ours = sent.json<{ message: Message }>().message;
    t.node.injectText(RIDGE, { channel: 0 }, "me, at 9", { replyId: ours.packetId });
    expect((await arrived("me, at 9")).notify?.reason).toBe("reply");
    expect(stored("me, at 9")?.isReplyToMe).toBe(true);
    t.node.injectText(RIDGE, { channel: 0 }, "👍", { replyId: ours.packetId, emoji: true });
    expect((await arrived("👍")).notify?.reason).toBe("reaction");
  });

  it("messages heard long before they reach us right after a reconnect are backlog", async () => {
    t.node.injectText(RIDGE, { to: ME }, "while you were away", {
      rxTimeMs: Date.now() - 5 * 60_000,
    });
    expect((await arrived("while you were away")).notify?.backlog).toBe(true);
    expect(stored("while you were away")?.isBacklog).toBe(true);
    t.node.injectText(RIDGE, { to: ME }, "just now");
    expect((await arrived("just now")).notify?.backlog).toBe(false);
  });

  it("per-conversation levels: All notifies every message; Mute is None", async () => {
    const all = await patch("/api/connections/1/conversations/channel/0", { notifyLevel: "all" });
    expect(all.json()).toMatchObject({ notifyLevel: "all", muted: false });
    t.node.injectText(RIDGE, { channel: 0 }, "chatter");
    expect((await arrived("chatter")).notify?.reason).toBe("channel-all");

    const mute = await patch(`/api/connections/1/conversations/dm/${RIDGE}`, { muted: true });
    expect(mute.json()).toMatchObject({ notifyLevel: "none", muted: true });
    t.node.injectText(RIDGE, { to: ME }, "muted dm");
    expect((await arrived("muted dm")).notify?.level).toBe("badge");
    const list = (
      await t.app.inject({ url: "/api/connections/1/conversations" })
    ).json<ConversationsDTO>();
    expect(list.channels[0]?.state.notifyLevel).toBe("all");
    expect(list.channels[1]?.state.notifyLevel).toBe("mentions");
    expect(list.dms.find((d) => d.peer === RIDGE)?.state.notifyLevel).toBe("none");

    // Back to the default: unmuted, and the level resets.
    const unmute = await patch(`/api/connections/1/conversations/dm/${RIDGE}`, { muted: false });
    expect(unmute.json()).toMatchObject({ notifyLevel: "dm-default", muted: false });
  });
});

describe("notification prefs", () => {
  it("defaults, then a change reaches the user's sockets and their keywords count", async () => {
    const get = await t.app.inject({ url: "/api/me/notification-prefs" });
    expect(get.json<NotificationPrefsDTO>()).toMatchObject({
      dndUntil: null,
      quietHours: null,
      quietAllowDms: false,
      mentionKeywords: [],
      reactionsMode: "in-app",
      matchShortName: true,
    });
    const res = await patch("/api/me/notification-prefs", {
      dndUntil: Date.now() + 3600_000,
      quietHours: { start: "22:00", end: "07:00" },
      mentionKeywords: ["pancakes", " pancakes "],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<NotificationPrefsDTO>().mentionKeywords).toEqual(["pancakes"]);
    await ws.waitFor(() => ws.ofType("notification-prefs.updated").length === 1);
    expect(ws.ofType("notification-prefs.updated")[0]?.prefs.quietHours).toEqual({
      start: "22:00",
      end: "07:00",
    });

    t.node.injectText(RIDGE, { channel: 1 }, "who wants pancakes?");
    expect((await arrived("who wants pancakes?")).notify?.reason).toBe("mention");
    // Keywords are per user: the stored flag only follows the node's own names.
    expect(stored("who wants pancakes?")?.mentionsMe).toBe(false);
  });

  it("refuses bad values", async () => {
    expect((await patch("/api/me/notification-prefs", {})).statusCode).toBe(400);
    const bad = await patch("/api/me/notification-prefs", {
      quietHours: { start: "7am", end: "9pm" },
    });
    expect(bad.statusCode).toBe(400);
  });
});
