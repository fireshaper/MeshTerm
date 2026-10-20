import {
  nodeIdFromNum,
  type CardPosition,
  type DashboardThresholds,
  type NodeCard,
} from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { MessageSquare, PanelRightOpen, Star } from "lucide-react";
import { openNodeDetails } from "../data/ui-store.js";
import { memo, type KeyboardEvent, type ReactNode } from "react";
import { BatteryMeter } from "./BatteryMeter.js";
import { formatAbsolute, formatAgo, formatDuration } from "./format.js";
import { bearingDegrees, cardinal, formatDistance, haversineMeters } from "./geo.js";
import { ageLabel, isStale, STATUS_LABELS } from "./insights.js";
import { roleLabel } from "./labels.js";
import { freshness, useUpdateFlash } from "./NodeCard.js";
import { SignalBars } from "./SignalBars.js";
import { nodeStatus } from "./view.js";

export interface NodePreviewCardProps {
  card: NodeCard;
  origin: CardPosition | null;
  now: number;
  thresholds: DashboardThresholds;
  onFavorite: (num: number, favorite: boolean) => void;
}

function Stat({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return (
    <div data-mt="preview-stat" data-mt-variant={name}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const hops = (n: number) => `${n} ${n === 1 ? "hop" : "hops"}`;

/**
 * A compact node summary for the dashboard: who, when last heard, power, signal and
 * where. Enter (or Details) opens the details drawer, `f` toggles favorite.
 */
export const NodePreviewCard = memo(function NodePreviewCard({
  card,
  origin,
  now,
  thresholds,
  onFavorite,
}: NodePreviewCardProps) {
  const flashing = useUpdateFlash(freshness(card));
  const status = nodeStatus(card.lastHeard, now, thresholds);
  const name = card.longName || card.shortName || card.userId;
  const device = card.device;
  const level = device?.batteryLevel ?? null;

  const toggleFavorite = () => {
    onFavorite(card.num, !card.isFavorite);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      openNodeDetails(card.num);
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      toggleFavorite();
    }
  };

  const variant = [card.isSelf ? "self" : null, card.isFavorite ? "favorite" : null, card.role]
    .filter((v) => v !== null)
    .join(" ");

  const distance =
    !card.isSelf && origin && card.position
      ? `${formatDistance(haversineMeters(origin, card.position))} ${cardinal(
          bearingDegrees(origin, card.position),
        )}`
      : null;

  return (
    <article
      data-mt="node-preview"
      data-mt-variant={variant}
      data-mt-state={flashing ? "updated" : status}
      data-node-num={card.num}
      tabIndex={0}
      aria-label={`${name}${card.isSelf ? " (my node)" : ""}, ${STATUS_LABELS[status]}`}
      onKeyDown={onKeyDown}
    >
      <header data-mt="node-preview-header">
        <span data-mt="status-dot" data-mt-state={status} title={STATUS_LABELS[status]} />
        <span data-mt="node-long-name" title={name}>
          {name}
        </span>
        <span data-mt="node-short-name">{card.shortName}</span>
        <button
          type="button"
          data-mt="favorite-toggle"
          data-mt-state={card.isFavorite ? "on" : "off"}
          aria-pressed={card.isFavorite}
          aria-label={card.isFavorite ? `Unfavorite ${name}` : `Favorite ${name}`}
          title="Favorite (f)"
          onClick={toggleFavorite}
        >
          <Star data-mt="icon" aria-hidden focusable={false} />
        </button>
      </header>
      <div data-mt="node-preview-meta">
        {card.isSelf && <span data-mt="self-badge">My node</span>}
        {card.role !== null && (
          <span data-mt="role-badge" data-mt-variant={card.role}>
            {roleLabel(card.role)}
          </span>
        )}
        <span data-mt="node-id">{card.userId}</span>
      </div>
      <dl data-mt="node-preview-stats">
        <Stat name="last-heard" label="Last heard">
          {card.lastHeard === null ? (
            "Never"
          ) : (
            <time
              dateTime={new Date(card.lastHeard).toISOString()}
              title={formatAbsolute(card.lastHeard)}
            >
              {formatAgo(card.lastHeard, now)}
            </time>
          )}
        </Stat>
        <Stat name="power" label="Power">
          <BatteryMeter level={level} />
          <span>{level === null ? "Unknown" : level > 100 ? "External" : `${level}%`}</span>
          {device && level !== null && isStale(device.time, now, thresholds) && (
            <span data-mt="stale-note" title={`Reported ${formatAbsolute(device.time)}`}>
              {ageLabel(device.time, now)}
            </span>
          )}
        </Stat>
        {card.isSelf ? (
          <Stat name="uptime" label="Uptime">
            {device?.uptimeSeconds == null ? "Unknown" : formatDuration(device.uptimeSeconds)}
          </Stat>
        ) : (
          <Stat name="signal" label="Signal">
            {card.hopsAway === 0 ? (
              <>
                <SignalBars snr={card.snr} />
                <span title="Last packet heard directly">
                  {card.snr === null ? "Unknown" : `${card.snr} dB`}
                  {card.rssi !== null && ` · ${card.rssi} dBm`}
                </span>
              </>
            ) : card.hopsAway === null ? (
              "Unknown"
            ) : (
              <span title="Hops of the last packet; the route isn't known">
                via {hops(card.hopsAway)}
              </span>
            )}
          </Stat>
        )}
        <Stat name="distance" label={card.isSelf ? "Altitude" : "Distance"}>
          {card.isSelf
            ? card.position?.alt == null
              ? "Unknown"
              : `${card.position.alt} m`
            : (distance ?? "Unknown")}
        </Stat>
      </dl>
      <footer data-mt="node-preview-actions">
        <button
          type="button"
          data-mt="button"
          data-mt-variant="details"
          onClick={() => {
            openNodeDetails(card.num);
          }}
        >
          <PanelRightOpen data-mt="icon" aria-hidden focusable={false} />
          Details
        </button>
        {!card.isSelf && (
          <Link
            to="/messages/dm/$nodeId"
            params={{ nodeId: nodeIdFromNum(card.num) }}
            data-mt="button"
            data-mt-variant="message"
          >
            <MessageSquare data-mt="icon" aria-hidden focusable={false} />
            Message
          </Link>
        )}
      </footer>
    </article>
  );
});
