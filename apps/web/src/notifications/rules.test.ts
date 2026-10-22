import {
  fixtures,
  type ConversationsDTO,
  type Message,
  type NotificationPrefsDTO,
  type NotifyHint,
} from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import { decide, isQuiet, SILENT, titleCount, type ViewContext } from "./rules.js";
import { DEFAULT_BROWSER_SETTINGS } from "./settings.js";

const NOW = Date.UTC(2026, 9, 22, 12, 0);
const PREFS: NotificationPrefsDTO = {
  dndUntil: null,
  quietHours: null,
  quietAllowDms: false,
  mentionKeywords: [],
  reactionsMode: "in-app",
  matchShortName: true,
  serverUtcOffsetMinutes: 0,
};
const dm: Message = { ...fixtures.inboundMessage };
const channelMsg: Message = { ...fixtures.inboundMessage, peer: null, channelIndex: 1 };
const hint = (reason: NotifyHint["reason"], over: Partial<NotifyHint> = {}): NotifyHint => ({
  level: "notify",
  reason,
  backlog: false,
  ...over,
});
const away: ViewContext = { viewing: null, visible: false, focused: false };
const here: ViewContext = { viewing: null, visible: true, focused: true };

describe("decide", () => {
  it("a DM while away: toast, message sound, OS (when enabled), flash; with priority", () => {
    const settings = { ...DEFAULT_BROWSER_SETTINGS, desktop: true };
    expect(decide(dm, hint("dm"), PREFS, settings, away, NOW)).toEqual({
      toast: true,
      sound: "message",
      os: true,
      flash: true,
      priority: true,
    });
    // Focused elsewhere in the app: a toast and a sound, no OS notification or flash.
    expect(decide(dm, hint("dm"), PREFS, settings, here, NOW)).toMatchObject({
      toast: true,
      os: false,
      flash: false,
    });
  });

  it("nothing for badge-only messages, the backlog, or the conversation being read", () => {
    const s = DEFAULT_BROWSER_SETTINGS;
    expect(decide(dm, undefined, PREFS, s, away, NOW)).toBe(SILENT);
    expect(decide(dm, { level: "badge", reason: null, backlog: false }, PREFS, s, away, NOW)).toBe(
      SILENT,
    );
    expect(decide(dm, hint("dm", { backlog: true }), PREFS, s, away, NOW)).toBe(SILENT);
    const reading: ViewContext = {
      ...here,
      viewing: { connectionId: 1, kind: "dm", key: dm.peer ?? 0 },
    };
    expect(decide(dm, hint("dm"), PREFS, s, reading, NOW)).toBe(SILENT);
    // The same thread in a hidden tab isn't being read.
    expect(decide(dm, hint("dm"), PREFS, s, { ...reading, visible: false }, NOW).toast).toBe(true);
  });

  it("Do Not Disturb and quiet hours silence alerts; DMs may pass quiet hours", () => {
    const s = DEFAULT_BROWSER_SETTINGS;
    expect(decide(dm, hint("dm"), { ...PREFS, dndUntil: NOW + 1 }, s, away, NOW)).toBe(SILENT);
    const quiet = { ...PREFS, quietHours: { start: "11:00", end: "13:00" } };
    expect(decide(dm, hint("dm"), quiet, s, away, NOW)).toBe(SILENT);
    expect(decide(dm, hint("dm"), { ...quiet, quietAllowDms: true }, s, away, NOW).toast).toBe(
      true,
    );
    expect(
      decide(channelMsg, hint("mention"), { ...quiet, quietAllowDms: true }, s, away, NOW),
    ).toBe(SILENT);
    expect(isQuiet({ ...PREFS, dndUntil: NOW - 1 }, NOW, false)).toBe(false);
  });

  it("reactions stay in the app unless they should notify; browser settings apply", () => {
    const s = { ...DEFAULT_BROWSER_SETTINGS, desktop: true };
    expect(decide(channelMsg, hint("reaction"), PREFS, s, away, NOW)).toEqual({
      toast: true,
      sound: null,
      os: false,
      flash: false,
      priority: false,
    });
    const loud = { ...PREFS, reactionsMode: "notify" as const };
    expect(decide(channelMsg, hint("reaction"), loud, s, away, NOW).os).toBe(true);
    const muted = { ...s, sounds: false, titleFlash: false, toasts: false };
    expect(decide(dm, hint("dm"), PREFS, muted, away, NOW)).toMatchObject({
      toast: false,
      sound: null,
      flash: false,
    });
    const noMention = { ...s, soundTypes: { ...s.soundTypes, mention: false } };
    expect(decide(channelMsg, hint("reply"), PREFS, noMention, away, NOW).sound).toBeNull();
    expect(decide(channelMsg, hint("channel-all"), PREFS, s, away, NOW)).toMatchObject({
      sound: "channel",
      priority: false,
    });
  });
});

describe("titleCount", () => {
  const state = (notifyLevel: "all" | "mentions" | "dm-default" | "none") => ({
    lastReadRxTime: 0,
    muted: notifyLevel === "none",
    favorite: false,
    notifyLevel,
  });
  const channel = (unread: number, unreadMentions: number, level: Parameters<typeof state>[0]) => ({
    index: 0,
    name: "LongFast",
    role: "PRIMARY" as const,
    encryption: null,
    lastMessage: null,
    unread,
    unreadMentions,
    state: state(level),
  });
  const preview = {
    id: dm.id,
    text: "",
    rxTime: 0,
    direction: "in" as const,
    emoji: false,
    pkiEncrypted: false,
    status: null,
  };
  const dmRow = (unread: number, level: Parameters<typeof state>[0], ignored = false) => ({
    peer: 1,
    lastMessage: preview,
    unread,
    unreadMentions: 0,
    state: state(level),
    ignored,
  });

  it("counts DMs, channels set to all, and mentions; never muted or ignored", () => {
    const data: ConversationsDTO = {
      channels: [channel(5, 0, "mentions"), channel(3, 1, "all"), channel(9, 2, "none")],
      dms: [dmRow(2, "dm-default"), dmRow(4, "none"), dmRow(7, "dm-default", true)],
    };
    expect(titleCount(data)).toEqual({ total: 5, priority: true });
    expect(titleCount({ channels: [channel(5, 0, "all")], dms: [] })).toEqual({
      total: 5,
      priority: false,
    });
    expect(titleCount({ channels: [channel(5, 2, "mentions")], dms: [] })).toEqual({
      total: 2,
      priority: true,
    });
    expect(titleCount(undefined)).toEqual({ total: 0, priority: false });
  });
});
