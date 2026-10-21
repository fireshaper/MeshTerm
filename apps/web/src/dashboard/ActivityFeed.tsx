import {
  channelDisplayName,
  nodeIdFromNum,
  type ActivityEvent,
  type ActivityKind,
  type NodeCard,
} from "@meshterm/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BatteryCharging,
  CircleDot,
  LockKeyhole,
  MessageSquare,
  PlugZap,
  Send,
  Unplug,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { EmptyState, Panel } from "../components/Panel.js";
import { useNow } from "../components/useNow.js";
import { loadOlderActivity, useActivity, useChannels } from "../data/queries.js";
import { openNodeDetails } from "../data/ui-store.js";
import { formatAbsolute, formatAgo, formatDuration } from "./format.js";

const ICONS: Record<ActivityKind, LucideIcon> = {
  "message.in": MessageSquare,
  "message.out": Send,
  "node.new": UserPlus,
  "node.back": CircleDot,
  "power.changed": BatteryCharging,
  "connection.lost": Unplug,
  "connection.restored": PlugZap,
  "message.undecryptable": LockKeyhole,
};

const POWER_TEXT: Record<string, (level: number | null) => string> = {
  ok: (l) => `Battery OK${l === null ? "" : ` (${l}%)`}`,
  low: (l) => `Battery low${l === null ? "" : ` (${l}%)`}`,
  critical: (l) => `Battery critical${l === null ? "" : ` (${l}%)`}`,
  external: () => "On external power",
};

/** What happened, in a few words. */
export function describeActivity(
  event: ActivityEvent,
  channelName: (index: number) => string = (i) => `channel ${i}`,
): string {
  const quote = event.detail === null ? "" : ` “${event.detail}”`;
  switch (event.kind) {
    case "message.in":
      return event.value === null
        ? `Direct message${quote}`
        : `Message on ${channelName(event.value)}${quote}`;
    case "message.out":
      return `You sent${quote}`;
    case "node.new":
      return "New node discovered";
    case "node.back":
      return event.value === null
        ? "Heard again"
        : `Heard again after ${formatDuration(event.value / 1000)}`;
    case "power.changed": {
      const to = event.detail?.split("→")[1] ?? "";
      return (POWER_TEXT[to] ?? (() => "Power changed"))(event.value);
    }
    case "connection.lost":
      return `Connection lost${event.detail ? ` (${event.detail})` : ""}`;
    case "connection.restored":
      return event.value === null
        ? "Connection restored"
        : `Connection restored after ${formatDuration(event.value / 1000)}`;
    case "message.undecryptable":
      return "Couldn't decrypt a message to my node (the sender may have an outdated key for it)";
  }
}

function Source({ event, cards }: { event: ActivityEvent; cards: ReadonlyMap<number, NodeCard> }) {
  if (event.nodeNum === null) {
    return (
      <span data-mt="activity-source">
        {event.kind.startsWith("connection") ? "My node" : "Channel"}
      </span>
    );
  }
  const card = cards.get(event.nodeNum);
  const name = card
    ? card.longName || card.shortName || card.userId
    : `!${event.nodeNum.toString(16).padStart(8, "0")}`;
  return (
    <button
      type="button"
      data-mt="activity-source"
      onClick={() => {
        if (event.nodeNum !== null) openNodeDetails(event.nodeNum);
      }}
    >
      {name}
    </button>
  );
}

function ActivityItem({
  event,
  cards,
  now,
  channelName,
}: {
  event: ActivityEvent;
  cards: ReadonlyMap<number, NodeCard>;
  now: number;
  channelName: (index: number) => string;
}) {
  const Icon = ICONS[event.kind];
  const text = describeActivity(event, channelName);
  const isMessage = event.kind === "message.in" || event.kind === "message.out";
  return (
    <li data-mt="activity-item" data-mt-variant={event.kind}>
      <span data-mt="activity-icon">
        <Icon data-mt="icon" aria-hidden focusable={false} />
      </span>
      <span data-mt="activity-main">
        <Source event={event} cards={cards} />
        {isMessage && event.value !== null ? (
          <Link
            to="/messages/channel/$index"
            params={{ index: String(event.value) }}
            data-mt="activity-text"
          >
            {text}
          </Link>
        ) : isMessage && event.nodeNum !== null ? (
          <Link
            to="/messages/dm/$nodeId"
            params={{ nodeId: nodeIdFromNum(event.nodeNum) }}
            data-mt="activity-text"
          >
            {text}
          </Link>
        ) : (
          <span data-mt="activity-text">{text}</span>
        )}
      </span>
      <time
        data-mt="activity-time"
        dateTime={new Date(event.time).toISOString()}
        title={formatAbsolute(event.time)}
      >
        {formatAgo(event.time, now)}
      </time>
    </li>
  );
}

/** Recent notable events, newest first, scrolling on its own. */
export function ActivityFeed({
  connectionId,
  cards,
}: {
  connectionId: number;
  cards: readonly NodeCard[];
}) {
  const qc = useQueryClient();
  const now = useNow();
  const { data, isPending, isError } = useActivity(connectionId);
  const [loading, setLoading] = useState(false);
  const byNum = new Map(cards.map((c) => [c.num, c]));
  const { data: channels } = useChannels(connectionId);
  const channelName = (index: number) => {
    const channel = channels?.find((c) => c.index === index);
    return channel ? channelDisplayName(channel, null) : `channel ${index}`;
  };

  return (
    <Panel variant="activity" title="Recent activity">
      {isPending ? (
        <div data-mt="skeleton" data-mt-variant="feed" aria-hidden />
      ) : isError ? (
        <p data-mt="activity-error" role="alert">
          Activity couldn&apos;t be loaded.
        </p>
      ) : data.events.length === 0 ? (
        <EmptyState title="Nothing yet">
          Messages, newly discovered nodes, power changes and connection changes show up here.
        </EmptyState>
      ) : (
        <div data-mt="activity-scroll">
          <ul data-mt="activity-feed" aria-live="polite" aria-relevant="additions">
            {data.events.map((event) => (
              <ActivityItem
                key={event.id}
                event={event}
                cards={byNum}
                now={now}
                channelName={channelName}
              />
            ))}
          </ul>
          {data.nextBefore !== null && (
            <button
              type="button"
              data-mt="activity-more"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void loadOlderActivity(qc, connectionId).finally(() => {
                  setLoading(false);
                });
              }}
            >
              {loading ? "Loading…" : "Load older"}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}
