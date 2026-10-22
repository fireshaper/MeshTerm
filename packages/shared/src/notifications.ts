import { z } from "zod";

/**
 * Per-conversation notification level (CR-003 §4): `all` every message notifies,
 * `mentions` only mentions and replies (the channel default), `dm-default` DMs notify
 * (the DM default), `none` badge only (what Mute sets).
 */
export const NotifyLevel = z.enum(["all", "mentions", "dm-default", "none"]);
export type NotifyLevel = z.infer<typeof NotifyLevel>;

/**
 * What the server thinks a new message deserves for the user of a socket (CR-003 §11).
 * The browser still applies its own settings, Do Not Disturb, quiet hours and whether
 * the conversation is open.
 */
export const NotifyHint = z.object({
  level: z.enum(["none", "badge", "notify"]),
  reason: z.enum(["dm", "mention", "reply", "reaction", "channel-all"]).nullable(),
  /** Part of the burst after a reconnect: summarized, not alerted one by one. */
  backlog: z.boolean(),
});
export type NotifyHint = z.infer<typeof NotifyHint>;

export const ReactionsMode = z.enum(["in-app", "notify", "off"]);
export type ReactionsMode = z.infer<typeof ReactionsMode>;

/** "HH:MM", 00:00–23:59. */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

/** Do Not Disturb set "until turned off". */
export const DND_FOREVER = Number.MAX_SAFE_INTEGER;

/** `GET/PATCH /api/me/notification-prefs`: one user's settings, synced across browsers. */
export const NotificationPrefsDTO = z.object({
  /** Do Not Disturb until (epoch ms); null: off; `DND_FOREVER`: until turned off. */
  dndUntil: z.number().int().nonnegative().nullable(),
  /** In the server's time zone; null: no quiet hours. */
  quietHours: z.object({ start: ClockTime, end: ClockTime }).nullable(),
  quietAllowDms: z.boolean(),
  /** Extra words that count as mentions (a callsign, "base"…). */
  mentionKeywords: z.array(z.string().trim().min(1).max(40)).max(20),
  reactionsMode: ReactionsMode,
  /** The short name on its own counts as a mention; `@short` always does. */
  matchShortName: z.boolean(),
  /** The server's UTC offset now (minutes), so browsers can place quiet hours. */
  serverUtcOffsetMinutes: z.number().int(),
});
export type NotificationPrefsDTO = z.infer<typeof NotificationPrefsDTO>;

export const NotificationPrefsPatch = NotificationPrefsDTO.omit({ serverUtcOffsetMinutes: true })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "nothing to change");
export type NotificationPrefsPatch = z.infer<typeof NotificationPrefsPatch>;

/** Whether `at` (epoch ms) falls in quiet hours, in a zone `offsetMinutes` from UTC. */
export function inQuietHours(
  quiet: { start: string; end: string } | null,
  at: number,
  offsetMinutes: number,
): boolean {
  if (!quiet) return false;
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const local = new Date(at + offsetMinutes * 60_000);
  const now = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = minutes(quiet.start);
  const end = minutes(quiet.end);
  if (start === end) return false;
  // 22:00–07:00 wraps past midnight.
  return start < end ? now >= start && now < end : now >= start || now < end;
}
