import {
  mentionMatcher,
  type Message,
  type NotificationPrefsDTO,
  type NotificationPrefsPatch,
  type NotifyHint,
  type NotifyLevel,
} from "@meshterm/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { userNotificationPrefs } from "../db/schema.js";

/** Messages received longer ago than this never notify (CR-003 §4.3). */
export const STALE_AFTER_MS = 24 * 3600_000;

/** The server's UTC offset now, in minutes (east positive), for quiet hours. */
export const serverUtcOffsetMinutes = (at: number): number => -new Date(at).getTimezoneOffset();

export function loadPrefs(db: Db, userId: number, now: number): NotificationPrefsDTO {
  const [row] = db
    .select()
    .from(userNotificationPrefs)
    .where(eq(userNotificationPrefs.userId, userId))
    .all();
  return {
    dndUntil: row?.dndUntil ?? null,
    quietHours:
      row?.quietStart && row.quietEnd ? { start: row.quietStart, end: row.quietEnd } : null,
    quietAllowDms: row?.quietAllowDms ?? false,
    mentionKeywords: row?.mentionKeywords ?? [],
    reactionsMode: row?.reactionsMode ?? "in-app",
    matchShortName: row?.matchShortName ?? true,
    serverUtcOffsetMinutes: serverUtcOffsetMinutes(now),
  };
}

export function savePrefs(
  db: Db,
  userId: number,
  patch: NotificationPrefsPatch,
  now: number,
): NotificationPrefsDTO {
  const given = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<NotificationPrefsDTO>;
  const next: NotificationPrefsDTO = { ...loadPrefs(db, userId, now), ...given };
  const values = {
    dndUntil: next.dndUntil,
    quietStart: next.quietHours?.start ?? null,
    quietEnd: next.quietHours?.end ?? null,
    quietAllowDms: next.quietAllowDms,
    // Blank and repeated keywords are dropped.
    mentionKeywords: [...new Set(next.mentionKeywords.map((k) => k.trim()).filter(Boolean))],
    reactionsMode: next.reactionsMode,
    matchShortName: next.matchShortName,
  };
  db.insert(userNotificationPrefs)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userNotificationPrefs.userId, set: values })
    .run();
  return loadPrefs(db, userId, now);
}

/** What the hint depends on, apart from the user. */
export interface MessageContext {
  /** Our node's owner names; null before the first handshake. */
  owner: { longName: string; shortName: string } | null;
  /** The conversation's effective level. */
  level: NotifyLevel;
  /** The sender is an ignored node. */
  ignored: boolean;
  now: number;
}

/**
 * CR-003 §4 for one user: `notify` (with the reason), `badge` (counts, no alert) or
 * `none`. Undefined for our own messages. Do Not Disturb, quiet hours, browser settings
 * and "the conversation is open" are applied by the browser.
 */
export function notifyHint(
  m: Message,
  ctx: MessageContext,
  prefs: Pick<NotificationPrefsDTO, "mentionKeywords" | "matchShortName" | "reactionsMode">,
): NotifyHint | undefined {
  if (m.direction !== "in") return undefined;
  const backlog = m.isBacklog ?? false;
  const hint = (level: NotifyHint["level"], reason: NotifyHint["reason"]): NotifyHint => ({
    level,
    reason,
    backlog,
  });
  if (ctx.ignored) return hint("none", null);
  if (m.emoji) {
    // Reactions don't count as unread; to our messages they show in the app (§4).
    return m.isReplyToMe && prefs.reactionsMode !== "off"
      ? hint("notify", "reaction")
      : hint("none", null);
  }
  if (ctx.now - m.rxTime > STALE_AFTER_MS) return hint("badge", null);
  if (ctx.level === "none") return hint("badge", null);

  const reply = m.isReplyToMe ?? false;
  const mention =
    ctx.owner !== null &&
    mentionMatcher({
      longName: ctx.owner.longName,
      shortName: ctx.owner.shortName,
      matchShortName: prefs.matchShortName,
      keywords: prefs.mentionKeywords,
    })(m.text);

  if (m.peer !== null) {
    // A DM: always, unless the user asked for mentions only.
    if (ctx.level === "mentions") {
      return mention ? hint("notify", "mention") : hint("badge", null);
    }
    return hint("notify", "dm");
  }
  if (mention) return hint("notify", "mention");
  if (reply) return hint("notify", "reply");
  if (ctx.level === "all") return hint("notify", "channel-all");
  return hint("badge", null);
}
