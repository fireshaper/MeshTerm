import {
  channelDisplayName,
  type ConversationsDTO,
  type Message,
  type MessagePreview,
} from "@meshterm/shared";
import type { Db } from "../db/database.js";
import { allStates, stateFrom, unreadCount, type StoredState } from "./read-state.js";
import {
  getModemPreset,
  ignoredNodes,
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
const publicState = ({ lastReadRxTime, muted, favorite }: StoredState) => ({
  lastReadRxTime,
  muted,
  favorite,
});

export function buildConversations(db: Db, connectionId: number): ConversationsDTO {
  const preset = getModemPreset(db, connectionId);
  const newest = (page: Message[]) => page[0] ?? null;
  const states = allStates(db, connectionId);
  const ignored = ignoredNodes(db, connectionId);
  return {
    channels: listChannels(db, connectionId)
      .filter((c) => c.role !== "DISABLED")
      .map((c) => {
        const last = newest(listChannelMessages(db, connectionId, c.index, { limit: 1 }));
        const state = stateFrom(states, "channel", c.index);
        return {
          index: c.index,
          name: channelDisplayName(c, preset),
          role: c.role,
          encryption: c.encryption,
          lastMessage: last ? toPreview(last) : null,
          unread: unreadCount(db, connectionId, "channel", c.index, state),
          state: publicState(state),
        };
      }),
    // A deleted DM comes back once a newer message arrives.
    dms: listDmPeers(db, connectionId).flatMap((peer) => {
      const state = stateFrom(states, "dm", peer);
      const last = newest(
        listDmMessages(db, connectionId, peer, { limit: 1 }, state.deletedBefore),
      );
      if (!last) return [];
      return [
        {
          peer,
          lastMessage: toPreview(last),
          unread: unreadCount(db, connectionId, "dm", peer, state),
          state: publicState(state),
          ignored: ignored.has(peer),
        },
      ];
    }),
  };
}
