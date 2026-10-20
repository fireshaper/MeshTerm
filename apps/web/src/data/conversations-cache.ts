import type { ConversationsDTO, Message, MessagePreview, MessageStatus } from "@meshterm/shared";

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
 * `message.new`: the message becomes its conversation's preview when it's the newest;
 * a DM from a new peer adds a row. DMs stay newest first. Unchanged data is returned as is.
 */
export function applyMessageToConversations(data: ConversationsDTO, m: Message): ConversationsDTO {
  if (m.peer === null) {
    const i = data.channels.findIndex((c) => c.index === m.channelIndex);
    const channel = data.channels[i];
    if (!channel || !isNewer(m, channel.lastMessage)) return data;
    const channels = [...data.channels];
    channels[i] = { ...channel, lastMessage: toPreview(m) };
    return { ...data, channels };
  }
  const existing = data.dms.find((d) => d.peer === m.peer);
  if (existing && !isNewer(m, existing.lastMessage)) return data;
  const dms = [
    { peer: m.peer, lastMessage: toPreview(m) },
    ...data.dms.filter((d) => d.peer !== m.peer),
  ].sort((a, b) => b.lastMessage.rxTime - a.lastMessage.rxTime);
  return { ...data, dms };
}

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
