import { fixtures, type Message, type NotificationPrefsDTO } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import { notifyHint, STALE_AFTER_MS, type MessageContext } from "./notify.js";

const NOW = 1_800_000_000_000;
const owner = { longName: "Kevin's Base", shortName: "K7AB" };
const prefs: Pick<NotificationPrefsDTO, "mentionKeywords" | "matchShortName" | "reactionsMode"> = {
  mentionKeywords: [],
  matchShortName: true,
  reactionsMode: "in-app",
};
const ctx = (over: Partial<MessageContext> = {}): MessageContext => ({
  owner,
  level: "mentions",
  ignored: false,
  now: NOW,
  ...over,
});
const channel = (text: string, over: Partial<Message> = {}): Message => ({
  ...fixtures.inboundMessage,
  peer: null,
  text,
  rxTime: NOW - 1_000,
  ...over,
});
const dm = (over: Partial<Message> = {}): Message => ({
  ...fixtures.inboundMessage,
  rxTime: NOW - 1_000,
  ...over,
});
// Each kind's default level unless a test says otherwise.
const level = (
  m: Message,
  c = ctx({ level: m.peer === null ? "mentions" : "dm-default" }),
  p = prefs,
) => notifyHint(m, c, p);

describe("notifyHint", () => {
  it("DMs notify; channels only on mentions and replies by default", () => {
    expect(level(dm())).toEqual({ level: "notify", reason: "dm", backlog: false });
    expect(level(channel("hello all"))).toEqual({ level: "badge", reason: null, backlog: false });
    expect(level(channel("@K7AB hi"))?.reason).toBe("mention");
    expect(level(channel("hi", { isReplyToMe: true }))?.reason).toBe("reply");
  });

  it("follows the conversation level", () => {
    expect(level(channel("hello"), ctx({ level: "all" }))?.reason).toBe("channel-all");
    expect(level(channel("@K7AB"), ctx({ level: "none" }))?.level).toBe("badge");
    expect(level(dm(), ctx({ level: "none" }))?.level).toBe("badge");
    expect(level(dm({ text: "nothing" }), ctx({ level: "mentions" }))?.level).toBe("badge");
    expect(level(dm({ text: "k7ab?" }), ctx({ level: "mentions" }))?.reason).toBe("mention");
  });

  it("the user's keywords and short-name setting decide mentions", () => {
    const keywords = { ...prefs, mentionKeywords: ["base camp"] };
    expect(level(channel("meet at base camp"), ctx(), keywords)?.reason).toBe("mention");
    const strict = { ...prefs, matchShortName: false };
    expect(level(channel("k7ab hi"), ctx(), strict)?.level).toBe("badge");
    expect(level(channel("@k7ab hi"), ctx(), strict)?.level).toBe("notify");
  });

  it("reactions to my messages show in the app unless turned off; others never", () => {
    const reaction = channel("👍", { emoji: true, replyId: 7, isReplyToMe: true });
    expect(level(reaction)).toEqual({ level: "notify", reason: "reaction", backlog: false });
    expect(level(reaction, ctx(), { ...prefs, reactionsMode: "off" })?.level).toBe("none");
    expect(level({ ...reaction, isReplyToMe: false })?.level).toBe("none");
  });

  it("ignored nodes never; old messages only count; backlog is passed on; ours get none", () => {
    expect(level(dm(), ctx({ ignored: true }))?.level).toBe("none");
    expect(level(dm({ rxTime: NOW - STALE_AFTER_MS - 1 }))?.level).toBe("badge");
    expect(level(dm({ isBacklog: true }))).toEqual({
      level: "notify",
      reason: "dm",
      backlog: true,
    });
    expect(level({ ...fixtures.outboundMessage })).toBeUndefined();
    // No owner yet (before a handshake): nothing counts as a mention.
    expect(level(channel("@K7AB"), ctx({ owner: null }))?.level).toBe("badge");
  });
});
