import type { MeshNode } from "@meshterm/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "../data/keys.js";
import { loadOlder, useConversation, useNodes } from "../data/queries.js";
import { useMarkRead } from "../messages/unread.js";
import { useNotifyCenter } from "../notifications/center.js";
import { useMentionTerms } from "../notifications/mention-terms.js";
import { dayLabel, MessageItem, senderName } from "./MessageItem.js";
import { useNow } from "./useNow.js";

/** How close to an edge (px) counts as "at the top" / "at the bottom". */
const EDGE = 80;

interface MessageListProps {
  connectionId: number;
  conversation: Conversation;
}

/**
 * A conversation's messages, oldest at the top, virtualized. Follows new messages
 * while the reader is at the bottom; reaching the top loads the next older page.
 */
export function MessageList({ connectionId, conversation }: MessageListProps) {
  const qc = useQueryClient();
  const { data, isPending } = useConversation(connectionId, conversation);
  const { data: nodeList } = useNodes(connectionId);
  const now = useNow();
  const mentions = useMentionTerms(connectionId);
  const messages = useMemo(() => data?.messages ?? [], [data]);
  const nodes = useMemo(
    () => new Map<number, MeshNode>((nodeList ?? []).map((n) => [n.num, n])),
    [nodeList],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const loading = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const firstId = useRef<string | null>(null);
  const lastCount = useRef(0);

  // TanStack Virtual returns fresh functions each render; this component isn't compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
    initialRect: { width: 400, height: 600 },
    getItemKey: (i) => messages[i]?.id ?? i,
  });

  // Keep the view steady when older messages are prepended, and follow new ones at the bottom.
  useLayoutEffect(() => {
    const count = messages.length;
    const first = messages[0]?.id ?? null;
    const prepended =
      firstId.current !== null && first !== firstId.current && count > lastCount.current;
    if (prepended) {
      const added = messages.findIndex((m) => m.id === firstId.current);
      if (added > 0) virtualizer.scrollToIndex(added, { align: "start" });
    } else if (count > 0 && (atBottom.current || lastCount.current === 0)) {
      virtualizer.scrollToIndex(count - 1, { align: "end" });
    }
    firstId.current = first;
    lastCount.current = count;
  }, [messages, virtualizer]);

  const cursor = data?.cursor ?? null;
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < EDGE;
    if (bottom !== atBottom.current) reportViewing(bottom);
    atBottom.current = bottom;
    if (el.scrollTop < EDGE && cursor && !loading.current) {
      loading.current = true;
      setLoadingOlder(true);
      void loadOlder(qc, connectionId, conversation).finally(() => {
        loading.current = false;
        setLoadingOlder(false);
      });
    }
  };

  useMarkRead(connectionId, conversation, messages, atBottom);

  // Notifications skip the conversation the reader is looking at (CR-003 §4).
  const reportViewing = (bottom: boolean) => {
    useNotifyCenter
      .getState()
      .setViewing(
        bottom
          ? "channel" in conversation
            ? { connectionId, kind: "channel", key: conversation.channel }
            : { connectionId, kind: "dm", key: conversation.peer }
          : null,
      );
  };
  useEffect(() => {
    useNotifyCenter
      .getState()
      .setViewing(
        "channel" in conversation
          ? { connectionId, kind: "channel", key: conversation.channel }
          : { connectionId, kind: "dm", key: conversation.peer },
      );
    return () => {
      useNotifyCenter.getState().setViewing(null);
    };
  }, [connectionId, conversation]);

  // Reset per conversation.
  useEffect(() => {
    atBottom.current = true;
    firstId.current = null;
    lastCount.current = 0;
  }, [connectionId, conversation]);

  const state = isPending ? "loading" : messages.length === 0 ? "empty" : "ready";
  const items = virtualizer.getVirtualItems();

  return (
    <div
      data-mt="message-list"
      data-mt-state={state}
      ref={scrollRef}
      onScroll={onScroll}
      role="log"
      aria-label="Messages"
      aria-busy={loadingOlder}
    >
      {state === "empty" && <p data-mt="message-list-empty">No messages yet.</p>}
      {cursor === null && messages.length > 0 && (
        <p data-mt="history-start">Start of conversation</p>
      )}
      <div data-mt="message-list-canvas" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const message = messages[item.index];
          if (!message) return null;
          const previous = messages[item.index - 1];
          const day = dayLabel(message.rxTime);
          const newDay = !previous || dayLabel(previous.rxTime) !== day;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              data-mt="message-row"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {/* Where a new day starts; hidden by default, some themes show it. */}
              {newDay && <p data-mt="day-separator">{day}</p>}
              <MessageItem
                message={message}
                sender={senderName(message.fromNum, nodes)}
                now={now}
                mentions={mentions}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
