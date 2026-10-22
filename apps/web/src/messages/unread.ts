import type { ConversationsDTO, Message } from "@meshterm/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type RefObject } from "react";
import { api } from "../data/api.js";
import {
  applyReadToConversations,
  unreadTotals,
  badgeText,
  type UnreadTotals,
} from "../data/conversations-cache.js";
import { queryKeys, type Conversation } from "../data/keys.js";
import { useConversationList } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";

/** Unread messages across conversations (not muted, not ignored), for badges and the title. */
export function useUnreadTotals(): UnreadTotals {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data } = useConversationList(connectionId);
  return unreadTotals(data);
}

export const BASE_TITLE = "MeshTerm";

/** `(N) MeshTerm` while there are unread messages (CR-003 §5; 99+ past 99). */
export function titleFor(total: number): string {
  return total > 0 ? `(${badgeText(total)}) ${BASE_TITLE}` : BASE_TITLE;
}

/** Keeps the tab title in step with the unread count. */
export function useUnreadTitle(): void {
  const { total } = useUnreadTotals();
  useEffect(() => {
    document.title = titleFor(total);
  }, [total]);
}

/** How long the newest message must have been in view before it counts as read. */
export const READ_AFTER_MS = 1_000;
const TICK_MS = 250;

const keyOf = (c: Conversation) =>
  "channel" in c
    ? { kind: "channel" as const, key: c.channel }
    : { kind: "dm" as const, key: c.peer };

/**
 * Marks a conversation read once its newest message has been in view (the list at the
 * bottom, the tab visible and focused) for 1 s (Messages spec §4). Sends nothing when
 * there's nothing new; the server's `conversation.read` updates every browser.
 */
export function useMarkRead(
  connectionId: number,
  conversation: Conversation,
  messages: readonly Message[],
  atBottom: RefObject<boolean>,
): void {
  const qc = useQueryClient();
  const newest = messages.at(-1)?.rxTime ?? 0;
  const latest = useRef({ newest, sent: 0 });
  useEffect(() => {
    latest.current.newest = newest;
  }, [newest]);

  useEffect(() => {
    latest.current.sent = 0;
    const { kind, key } = keyOf(conversation);
    let since: number | null = null;
    const timer = setInterval(() => {
      const { newest: upTo, sent } = latest.current;
      const list = qc.getQueryData<ConversationsDTO>(queryKeys.conversations(connectionId));
      const row =
        kind === "channel"
          ? list?.channels.find((c) => c.index === key)
          : list?.dms.find((d) => d.peer === key);
      const unread = row ? row.unread > 0 && upTo > row.state.lastReadRxTime : false;
      const inView =
        atBottom.current && document.visibilityState === "visible" && document.hasFocus();
      if (!unread || !inView || upTo <= sent) {
        since = null;
        return;
      }
      since ??= Date.now();
      if (Date.now() - since < READ_AFTER_MS) return;
      since = null;
      latest.current.sent = upTo;
      void api.markRead(connectionId, kind, key, upTo).then(
        (state) => {
          qc.setQueryData<ConversationsDTO>(queryKeys.conversations(connectionId), (d) =>
            d ? applyReadToConversations(d, kind, key, state.lastReadRxTime).data : d,
          );
        },
        () => {
          // Try again on the next tick.
          latest.current.sent = 0;
        },
      );
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [qc, connectionId, conversation, atBottom]);
}
