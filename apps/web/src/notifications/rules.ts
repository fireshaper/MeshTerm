import {
  inQuietHours,
  type ConversationsDTO,
  type Message,
  type NotificationPrefsDTO,
  type NotifyHint,
} from "@meshterm/shared";
import type { BrowserNotifySettings } from "./settings.js";

/**
 * The browser's half of CR-003's rules: the server's hint for this user, then Do Not
 * Disturb, quiet hours, this browser's settings and whether the reader is already
 * looking at the conversation. One place, reused for non-message alerts later.
 */

export type SoundKind = "message" | "mention" | "channel";

export interface Alert {
  /** In-app toast (N3). */
  toast: boolean;
  sound: SoundKind | null;
  /** OS notification (N4); only when the tab isn't focused. */
  os: boolean;
  /** Flash the title (the tab is hidden). */
  flash: boolean;
  /** DMs and mentions are announced assertively, the rest politely (CR-003 §6.1). */
  priority: boolean;
}

export const SILENT: Alert = {
  toast: false,
  sound: null,
  os: false,
  flash: false,
  priority: false,
};

/** Where the reader is: the conversation in view (if any) and the tab's state. */
export interface ViewContext {
  /** The open conversation, scrolled to the bottom. */
  viewing: { connectionId: number; kind: "channel" | "dm"; key: number } | null;
  visible: boolean;
  focused: boolean;
}

/** Do Not Disturb or quiet hours, for this kind of message (DMs may pass quiet hours). */
export function isQuiet(
  prefs: NotificationPrefsDTO | undefined,
  now: number,
  dm: boolean,
): boolean {
  if (!prefs) return false;
  if (prefs.dndUntil !== null && prefs.dndUntil > now) return true;
  if (!inQuietHours(prefs.quietHours, now, prefs.serverUtcOffsetMinutes)) return false;
  return !(dm && prefs.quietAllowDms);
}

const SOUNDS: Record<NonNullable<NotifyHint["reason"]>, SoundKind | null> = {
  dm: "message",
  mention: "mention",
  reply: "mention",
  "channel-all": "channel",
  reaction: null,
};

export function decide(
  message: Message,
  hint: NotifyHint | undefined,
  prefs: NotificationPrefsDTO | undefined,
  settings: BrowserNotifySettings,
  view: ViewContext,
  now: number,
): Alert {
  if (!hint || hint.level !== "notify" || !hint.reason) return SILENT;
  // The burst after a reconnect is summarized once (notifications.backlog).
  if (hint.backlog) return SILENT;
  const dm = message.peer !== null;
  if (isQuiet(prefs, now, dm)) return SILENT;
  const key = dm ? (message.peer ?? 0) : message.channelIndex;
  const looking =
    view.visible &&
    view.focused &&
    view.viewing !== null &&
    view.viewing.connectionId === message.connectionId &&
    view.viewing.kind === (dm ? "dm" : "channel") &&
    view.viewing.key === key;
  if (looking) return SILENT;

  // Reactions stay in the app unless the user wants them to notify (CR-003 §4).
  const inAppOnly = hint.reason === "reaction" && prefs?.reactionsMode !== "notify";
  const kind = SOUNDS[hint.reason];
  const sound =
    !inAppOnly && settings.sounds && kind !== null && settings.soundTypes[kind] ? kind : null;
  const away = !view.visible || !view.focused;
  return {
    toast: settings.toasts,
    sound,
    os: !inAppOnly && settings.desktop && away,
    flash: !inAppOnly && settings.titleFlash && !view.visible,
    priority: hint.reason === "dm" || hint.reason === "mention" || hint.reason === "reply",
  };
}

export interface TitleCount {
  total: number;
  /** A DM or a mention among them (red badge, CR-003 §6.2). */
  priority: boolean;
}

/**
 * CR-003 §5: unread DMs, channels at level "all", and unread mentions everywhere else;
 * nothing from muted (`none`) conversations or ignored DMs.
 */
export function titleCount(data: ConversationsDTO | undefined): TitleCount {
  if (!data) return { total: 0, priority: false };
  let total = 0;
  let priority = false;
  for (const c of data.channels) {
    const level = c.state.notifyLevel;
    if (level === "none") continue;
    total += level === "all" ? c.unread : c.unreadMentions;
    if (c.unreadMentions > 0) priority = true;
  }
  for (const d of data.dms) {
    const level = d.state.notifyLevel;
    if (d.ignored || level === "none") continue;
    const n = level === "mentions" ? d.unreadMentions : d.unread;
    total += n;
    if (n > 0) priority = true;
  }
  return { total, priority };
}
