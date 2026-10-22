import {
  channelDisplayName,
  mentionMatcher,
  type ConversationsDTO,
  type Message,
  type MessagePreview,
} from "@meshterm/shared";
import type { Db } from "../db/database.js";
import { allStates, publicState, stateFrom, unreadCount, unreadMentions } from "./read-state.js";
import { loadPrefs } from "./notify.js";
import {
  getModemPreset,
  getMyNodeNum,
  getNode,
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
export function buildConversations(
  db: Db,
  connectionId: number,
  /** Whose mentions count (their keywords); 0 with accounts off. */
  userId = 0,
): ConversationsDTO {
  const preset = getModemPreset(db, connectionId);
  const newest = (page: Message[]) => page[0] ?? null;
  const states = allStates(db, connectionId);
  const ignored = ignoredNodes(db, connectionId);
  const me = getMyNodeNum(db, connectionId);
  const own = me === null ? null : getNode(db, connectionId, me);
  const prefs = loadPrefs(db, userId, 0);
  const mentions = own
    ? mentionMatcher({
        longName: own.longName,
        shortName: own.shortName,
        matchShortName: prefs.matchShortName,
        keywords: prefs.mentionKeywords,
      })
    : () => false;
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
          unreadMentions: unreadMentions(db, connectionId, "channel", c.index, state, mentions),
          state: publicState("channel", state),
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
          unreadMentions: unreadMentions(db, connectionId, "dm", peer, state, mentions),
          state: publicState("dm", state),
          ignored: ignored.has(peer),
        },
      ];
    }),
  };
}
