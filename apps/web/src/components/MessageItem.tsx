import {
  nodeIdFromNum,
  type MentionTerms,
  type MeshNode,
  type Message,
  type MessageStatus,
} from "@meshterm/shared";
import { formatDistanceStrict } from "date-fns";
import { Check, CheckCheck, Clock, Reply, TriangleAlert } from "lucide-react";
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

/** A quoted message this one replies to. */
export interface ReplyQuote {
  sender: string;
  text: string;
}

const STATUS_ICONS: Record<MessageStatus, typeof Clock> = {
  queued: Clock,
  sent: Check,
  acked: CheckCheck,
  failed: TriangleAlert,
};

interface MessageItemProps {
  message: Message;
  /** The sender's callsign (short name, else long name, else `!id`). */
  sender: string;
  /** The sender's long name, shown in the bubble's header (CR-005). */
  senderLong?: string | undefined;
  /** "4.6 km · direct · 7.25 dB", incoming only. */
  path?: string | null;
  reply?: ReplyQuote | null;
  now: number;
  /** Marks mentions of this user in incoming messages (CR-003 §4.1). */
  mentions?: MentionTerms | null;
}

/**
 * One message. Incoming ones get a callsign avatar and a header line (name · distance ·
 * hops · SNR); time and delivery state sit at the foot of the bubble. Themes that draw
 * log lines (Retro) flatten `message-bubble`, `message-meta` and `message-foot`.
 */
export const MessageItem = memo(function MessageItem({
  message,
  sender,
  senderLong,
  path = null,
  reply = null,
  now,
  mentions = null,
}: MessageItemProps) {
  const { direction, status, rxTime, text } = message;
  const relayed = message.relayed && status === "sent";
  const StatusIcon = status ? STATUS_ICONS[status] : null;
  const openSender = () => {
    openNodeDetails(message.fromNum);
  };
  return (
    <article
      data-mt="message"
      data-mt-variant={direction}
      data-mt-state={status ?? "received"}
      aria-label={`${sender}: ${text}`}
    >
      {direction === "in" && (
        <span data-mt="message-avatar" aria-hidden>
          {sender}
        </span>
      )}
      <div data-mt="message-bubble">
        <header data-mt="message-meta">
          <button type="button" data-mt="message-sender" title="Node details" onClick={openSender}>
            <span data-mt="message-sender-short">{sender}</span>
            {senderLong && senderLong !== sender && (
              <span data-mt="message-sender-long">{senderLong}</span>
            )}
          </button>
          {direction === "in" && path && <span data-mt="message-path">{path}</span>}
        </header>
        {reply && (
          <blockquote data-mt="message-reply">
            <Reply data-mt="icon" aria-hidden focusable={false} />
            <span data-mt="message-reply-sender">{reply.sender}</span>
            <span data-mt="message-reply-text">{reply.text}</span>
          </blockquote>
        )}
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
        <footer data-mt="message-foot">
          <time
            data-mt="message-time"
            dateTime={new Date(rxTime).toISOString()}
            title={new Date(rxTime).toLocaleString()}
          >
            {/* Relative for themes that want it; the clock time shows by default (CR-005). */}
            <span data-mt="message-time-relative">
              {formatDistanceStrict(rxTime, Math.max(now, rxTime), { addSuffix: true })}
            </span>
            <span data-mt="message-time-clock">{clockTime(rxTime)}</span>
          </time>
          {direction === "out" && status && StatusIcon && (
            <span
              data-mt="message-status"
              data-mt-state={status}
              data-mt-variant={relayed ? "relayed" : undefined}
              title={relayed ? RELAYED_HINT : undefined}
            >
              <StatusIcon data-mt="icon" aria-hidden focusable={false} />
              {relayed ? "Relayed, not confirmed" : STATUS_LABELS[status]}
            </span>
          )}
        </footer>
      </div>
    </article>
  );
});
