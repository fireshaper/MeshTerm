import {
  nodeIdFromNum,
  type MentionTerms,
  type MeshNode,
  type Message,
  type MessageStatus,
} from "@meshterm/shared";
import { formatDistanceStrict } from "date-fns";
import { memo } from "react";
import { openNodeDetails } from "../data/ui-store.js";
import { splitMentions } from "../notifications/mention-terms.js";

/** Status text for outgoing messages, so state never depends on color alone. */
export const STATUS_LABELS: Record<MessageStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  acked: "Acknowledged",
  failed: "Failed",
};

/** A DM our node heard rebroadcast, without an ACK from its recipient (yet). */
/** "10:04": a message's local time of day, 24-hour. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** "Tue 20 Oct": the day a message is from, for day separators. */
export function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export const RELAYED_HINT =
  "The mesh relayed it, but the recipient hasn't confirmed it. It may still arrive, or it may not reach them.";

export function senderName(fromNum: number, nodes: ReadonlyMap<number, MeshNode>): string {
  const node = nodes.get(fromNum);
  return node?.shortName || node?.longName || nodeIdFromNum(fromNum);
}

interface MessageItemProps {
  message: Message;
  sender: string;
  now: number;
  /** Marks mentions of this user in incoming messages (CR-003 §4.1). */
  mentions?: MentionTerms | null;
}

export const MessageItem = memo(function MessageItem({
  message,
  sender,
  now,
  mentions = null,
}: MessageItemProps) {
  const { direction, status, rxTime, text } = message;
  return (
    <article
      data-mt="message"
      data-mt-variant={direction}
      data-mt-state={status ?? "received"}
      aria-label={`${sender}: ${text}`}
    >
      <header data-mt="message-meta">
        <button
          type="button"
          data-mt="message-sender"
          title="Node details"
          onClick={() => {
            openNodeDetails(message.fromNum);
          }}
        >
          {sender}
        </button>
        <time
          data-mt="message-time"
          dateTime={new Date(rxTime).toISOString()}
          title={new Date(rxTime).toLocaleString()}
        >
          <span data-mt="message-time-relative">
            {formatDistanceStrict(rxTime, Math.max(now, rxTime), { addSuffix: true })}
          </span>
          {/* For themes that show clock times (Retro's log lines); hidden by default. */}
          <span data-mt="message-time-clock">{clockTime(rxTime)}</span>
        </time>
      </header>
      <p data-mt="message-text">
        {splitMentions(text, direction === "in" ? mentions : null).map((part, i) =>
          part.mention ? (
            <mark key={i} data-mt="mention">
              {part.text}
            </mark>
          ) : (
            part.text
          ),
        )}
      </p>
      {direction === "out" && status && (
        <span
          data-mt="message-status"
          data-mt-state={status}
          data-mt-variant={message.relayed && status === "sent" ? "relayed" : undefined}
          title={message.relayed && status === "sent" ? RELAYED_HINT : undefined}
        >
          {message.relayed && status === "sent" ? "Relayed, not confirmed" : STATUS_LABELS[status]}
        </span>
      )}
    </article>
  );
});
