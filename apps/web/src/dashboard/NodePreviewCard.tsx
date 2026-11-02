import {
  nodeIdFromNum,
  type CardPosition,
  type DashboardThresholds,
  type NodeCard,
} from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { MessageSquare, Star } from "lucide-react";
import { openNodeDetails } from "../data/ui-store.js";
import { memo, type KeyboardEvent, type ReactNode } from "react";
import { BatteryMeter } from "./BatteryMeter.js";
import { formatAbsolute, formatAgo, formatDuration } from "./format.js";
import { BearingArrow } from "./BearingArrow.js";
import { bearingDegrees, formatDistance, haversineMeters } from "./geo.js";
import { ageLabel, isStale, STATUS_LABELS } from "./insights.js";
import { hardwareLabel, roleLabel } from "./labels.js";
import { freshness, useUpdateFlash } from "./NodeCard.js";
import { SignalBars } from "./SignalBars.js";
import { nodeStatus } from "./view.js";
import { useIsAdmin, VIEWER_HINT } from "../auth/me.js";

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
 * A roster card on the Overview (CR-005 §6.2): callsign, name, bearing from my node,
 * last heard, signal or hops, power, role · hardware and distance. A click or Enter
 * opens the details drawer, `f` toggles favorite.
 */
export const NodePreviewCard = memo(function NodePreviewCard({
  card,
  origin,
  now,
  thresholds,
  onFavorite,
}: NodePreviewCardProps) {
  const canFavorite = useIsAdmin();
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

  const bearing =
    !card.isSelf && origin && card.position ? bearingDegrees(origin, card.position) : null;
  const distance =
    !card.isSelf && origin && card.position
      ? formatDistance(haversineMeters(origin, card.position))
      : null;
  const hardware = [
    card.role === null ? null : roleLabel(card.role),
    card.hwModel === null ? null : hardwareLabel(card.hwModel),
  ]
    .filter((v) => v !== null)
    .join(" · ");

  return (
    <article
      data-mt="node-preview"
      data-mt-variant={variant}
      data-mt-state={flashing ? "updated" : status}
      data-node-num={card.num}
      tabIndex={0}
      aria-label={`${name}${card.isSelf ? " (my node)" : ""}, ${STATUS_LABELS[status]}`}
      title="Show details (Enter)"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // The whole card opens the details; its own buttons and links do their own thing.
        if ((e.target as Element).closest("button, a")) return;
        openNodeDetails(card.num);
      }}
    >
      <header data-mt="node-preview-header">
        <span data-mt="node-short-name">{card.shortName || "?"}</span>
        <span data-mt="node-long-name" title={name}>
          {name}
        </span>
        {card.isSelf ? (
          <span data-mt="self-badge">You</span>
        ) : (
          bearing !== null && <BearingArrow degrees={bearing} />
        )}
        <button
          type="button"
          data-mt="favorite-toggle"
          disabled={!canFavorite}
          {...(canFavorite ? {} : { title: VIEWER_HINT })}
          data-mt-state={card.isFavorite ? "on" : "off"}
          aria-pressed={card.isFavorite}
          aria-label={card.isFavorite ? `Unfavorite ${name}` : `Favorite ${name}`}
          title="Favorite (f)"
          onClick={toggleFavorite}
        >
          <Star data-mt="icon" aria-hidden focusable={false} />
        </button>
      </header>
      <dl data-mt="node-preview-stats">
        <Stat name="last-heard" label="Last heard">
          <span data-mt="status-dot" data-mt-state={status} title={STATUS_LABELS[status]} />
          {card.isSelf ? (
            "now"
          ) : card.lastHeard === null ? (
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
                </span>
              </>
            ) : card.hopsAway === null ? (
              "Unknown"
            ) : (
              <span title="Hops of the last packet; the route isn't known">
                {hops(card.hopsAway)}
              </span>
            )}
          </Stat>
        )}
        <Stat name="power" label="Power">
          <BatteryMeter level={level} />
          <span>{level === null ? "Unknown" : level > 100 ? "External" : `${level}%`}</span>
          {device && level !== null && isStale(device.time, now, thresholds) && (
            <span data-mt="stale-note" title={`Reported ${formatAbsolute(device.time)}`}>
              {ageLabel(device.time, now)}
            </span>
          )}
        </Stat>
      </dl>
      <footer data-mt="node-preview-actions">
        <span data-mt="node-preview-meta">{hardware || card.userId}</span>
        {distance !== null && <span data-mt="node-preview-distance">{distance}</span>}
        {!card.isSelf && (
          <Link
            to="/messages/dm/$nodeId"
            params={{ nodeId: nodeIdFromNum(card.num) }}
            data-mt="icon-button"
            data-mt-variant="message"
            aria-label={`Message ${name}`}
            title={`Message ${name}`}
          >
            <MessageSquare data-mt="icon" aria-hidden focusable={false} />
          </Link>
        )}
      </footer>
    </article>
  );
});
