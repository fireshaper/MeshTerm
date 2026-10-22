import type {
  ConversationKind,
  ConversationState,
  ConversationsDTO,
  Message,
  MessagePreview,
  MessageStatus,
} from "@meshterm/shared";

export const NEW_STATE: ConversationState = { lastReadRxTime: 0, muted: false, favorite: false };

/** Counts toward unread: incoming, not a reaction, after the read mark (CR-003 N0). */
const countsUnread = (m: Message, state: ConversationState) =>
  m.direction === "in" && !m.emoji && m.rxTime > state.lastReadRxTime;

export function toPreview(m: Message): MessagePreview {
  return {
    id: m.id,
    text: m.text,
    rxTime: m.rxTime,
    direction: m.direction,
    emoji: m.emoji,
    pkiEncrypted: m.pkiEncrypted,
    status: m.status,
  };
}

const isNewer = (m: Message, last: MessagePreview | null) =>
  last === null || m.rxTime > last.rxTime || (m.rxTime === last.rxTime && m.id > last.id);

/**
 * `message.new`: the message becomes its conversation's preview when it's the newest,
 * and counts as unread when it's incoming after the read mark; a DM from a new peer adds
 * a row. DMs stay newest first. Unchanged data is returned as is. `ignored`: nodes whose
 * messages don't count as unread.
 */
export function applyMessageToConversations(
  data: ConversationsDTO,
  m: Message,
  ignored: ReadonlySet<number> = new Set(),
): ConversationsDTO {
  const counts = (state: ConversationState) => countsUnread(m, state) && !ignored.has(m.fromNum);
  if (m.peer === null) {
    const i = data.channels.findIndex((c) => c.index === m.channelIndex);
    const channel = data.channels[i];
    if (!channel) return data;
    const newer = isNewer(m, channel.lastMessage);
    const unread = counts(channel.state);
    if (!newer && !unread) return data;
    const channels = [...data.channels];
    channels[i] = {
      ...channel,
      ...(newer ? { lastMessage: toPreview(m) } : {}),
      unread: channel.unread + (unread ? 1 : 0),
    };
    return { ...data, channels };
  }
  const existing = data.dms.find((d) => d.peer === m.peer);
  const state = existing?.state ?? NEW_STATE;
  const newer = !existing || isNewer(m, existing.lastMessage);
  const unread = counts(state);
  if (!newer && !unread) return data;
  const row = {
    peer: m.peer,
    lastMessage: newer ? toPreview(m) : existing.lastMessage,
    unread: (existing?.unread ?? 0) + (unread ? 1 : 0),
    state,
    ignored: existing?.ignored ?? ignored.has(m.peer),
  };
  const dms = [row, ...data.dms.filter((d) => d.peer !== m.peer)].sort(
    (a, b) => b.lastMessage.rxTime - a.lastMessage.rxTime,
  );
  return { ...data, dms };
}

type Row = ConversationsDTO["channels"][number] | ConversationsDTO["dms"][number];

function patchRow(
  data: ConversationsDTO,
  kind: ConversationKind,
  key: number,
  patch: (row: Row) => Row,
): ConversationsDTO {
  if (kind === "channel") {
    const i = data.channels.findIndex((c) => c.index === key);
    const row = data.channels[i];
    if (!row) return data;
    const channels = [...data.channels];
    channels[i] = patch(row) as typeof row;
    return { ...data, channels };
  }
  const i = data.dms.findIndex((d) => d.peer === key);
  const row = data.dms[i];
  if (!row) return data;
  const dms = [...data.dms];
  dms[i] = patch(row) as typeof row;
  return { ...data, dms };
}

/**
 * `conversation.read`: the new read mark. Read up to the newest message clears the
 * count; otherwise `stale` is true and the caller re-fetches the exact count.
 */
export function applyReadToConversations(
  data: ConversationsDTO,
  kind: ConversationKind,
  key: number,
  lastReadRxTime: number,
): { data: ConversationsDTO; stale: boolean } {
  const result = { stale: false };
  const next = patchRow(data, kind, key, (row) => {
    const allRead = !row.lastMessage || lastReadRxTime >= row.lastMessage.rxTime;
    if (!allRead) result.stale = true;
    return {
      ...row,
      state: { ...row.state, lastReadRxTime: Math.max(row.state.lastReadRxTime, lastReadRxTime) },
      unread: allRead ? 0 : row.unread,
    };
  });
  return { data: next, stale: result.stale };
}

/** `conversation.updated`: mute and favorite. */
export function applyStateToConversations(
  data: ConversationsDTO,
  kind: ConversationKind,
  key: number,
  state: ConversationState,
): ConversationsDTO {
  return patchRow(data, kind, key, (row) => ({ ...row, state }));
}

export interface UnreadTotals {
  /** Unread messages in conversations that aren't muted (ignored DMs never count). */
  total: number;
  /** Any unread DM among them (CR-003 §6.2 shows those with priority). */
  dm: boolean;
}

/** What the Messages badge and the tab title show. */
export function unreadTotals(data: ConversationsDTO | undefined): UnreadTotals {
  if (!data) return { total: 0, dm: false };
  let total = 0;
  let dm = false;
  for (const c of data.channels) if (!c.state.muted) total += c.unread;
  for (const d of data.dms) {
    if (d.state.muted || d.ignored) continue;
    total += d.unread;
    if (d.unread > 0) dm = true;
  }
  return { total, dm };
}

/** "99+" past 99. */
export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

/** `message.status`: updates the preview showing that message, if any. */
export function applyStatusToConversations(
  data: ConversationsDTO,
  messageId: string,
  status: MessageStatus,
): ConversationsDTO {
  const patch = <T extends { lastMessage: MessagePreview | null }>(row: T): T =>
    row.lastMessage?.id === messageId && row.lastMessage.status !== status
      ? { ...row, lastMessage: { ...row.lastMessage, status } }
      : row;
  const channels = data.channels.map(patch);
  const dms = data.dms.map(patch);
  const changed =
    channels.some((c, i) => c !== data.channels[i]) || dms.some((d, i) => d !== data.dms[i]);
  return changed ? { channels, dms } : data;
}
