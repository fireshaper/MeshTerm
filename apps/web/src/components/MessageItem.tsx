import { nodeIdFromNum, type MeshNode, type Message, type MessageStatus } from "@meshterm/shared";
import { formatDistanceStrict } from "date-fns";
import { memo } from "react";

/** Status text for outgoing messages, so state never depends on color alone. */
export const STATUS_LABELS: Record<MessageStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  acked: "Acknowledged",
  failed: "Failed",
};

export function senderName(fromNum: number, nodes: ReadonlyMap<number, MeshNode>): string {
  const node = nodes.get(fromNum);
  return node?.shortName || node?.longName || nodeIdFromNum(fromNum);
}

interface MessageItemProps {
  message: Message;
  sender: string;
  now: number;
}

export const MessageItem = memo(function MessageItem({ message, sender, now }: MessageItemProps) {
  const { direction, status, rxTime, text } = message;
  return (
    <article
      data-mt="message"
      data-mt-variant={direction}
      data-mt-state={status ?? "received"}
      aria-label={`${sender}: ${text}`}
    >
      <header data-mt="message-meta">
        <span data-mt="message-sender">{sender}</span>
        <time
          data-mt="message-time"
          dateTime={new Date(rxTime).toISOString()}
          title={new Date(rxTime).toLocaleString()}
        >
          {formatDistanceStrict(rxTime, Math.max(now, rxTime), { addSuffix: true })}
        </time>
      </header>
      <p data-mt="message-text">{text}</p>
      {direction === "out" && status && (
        <span data-mt="message-status" data-mt-state={status}>
          {STATUS_LABELS[status]}
        </span>
      )}
    </article>
  );
});
