import {
  channelDisplayName,
  type ConversationsDTO,
  type Message,
  type MessagePreview,
} from "@meshterm/shared";
import type { Db } from "../db/database.js";
import {
  getModemPreset,
  listChannelMessages,
  listChannels,
  listDmMessages,
  listDmPeers,
} from "../db/repositories.js";

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

/**
 * The conversation list in one call: every enabled channel (index order) and every
 * DM peer with a message (newest first), each with its newest message. One indexed
 * `LIMIT 1` query per conversation.
 */
export function buildConversations(db: Db, connectionId: number): ConversationsDTO {
  const preset = getModemPreset(db, connectionId);
  const newest = (page: Message[]) => page[0] ?? null;
  return {
    channels: listChannels(db, connectionId)
      .filter((c) => c.role !== "DISABLED")
      .map((c) => {
        const last = newest(listChannelMessages(db, connectionId, c.index, { limit: 1 }));
        return {
          index: c.index,
          name: channelDisplayName(c, preset),
          role: c.role,
          encryption: c.encryption,
          lastMessage: last ? toPreview(last) : null,
        };
      }),
    dms: listDmPeers(db, connectionId).flatMap((peer) => {
      const last = newest(listDmMessages(db, connectionId, peer, { limit: 1 }));
      return last ? [{ peer, lastMessage: toPreview(last) }] : [];
    }),
  };
}
