import type { CardPosition, DashboardThresholds, NodeCard as NodeCardData } from "@meshterm/shared";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, PanelRightOpen, Star } from "lucide-react";
import { openNodeDetails } from "../data/ui-store.js";
import { memo, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { BatteryMeter, Sparkline } from "./BatteryMeter.js";
import {
  formatAbsolute,
  formatAgo,
  formatDuration,
  formatEnvironment,
  formatPercent,
} from "./format.js";
import { bearingDegrees, cardinal, formatDistance, haversineMeters } from "./geo.js";
import { hardwareLabel, roleLabel } from "./labels.js";
import { MiniMap } from "./MiniMap.js";
import { STATUS_LABELS } from "./insights.js";
import { nodeStatus, type Density } from "./view.js";

/** How long a card shows `data-mt-state="updated"` after new data arrives. */
export const UPDATE_FLASH_MS = 1500;

export interface NodeCardProps {
  card: NodeCardData;
  /** My node's position, for distance and bearing. */
  origin: CardPosition | null;
  now: number;
  thresholds: DashboardThresholds;
  density: Density;
  onFavorite: (num: number, favorite: boolean) => void;
}

/** When any of these move, the card has new data and flashes. */
export const freshness = (c: NodeCardData) =>
  [c.lastHeard, c.device?.time, c.environment?.time, c.position?.time].join("|");

export function useUpdateFlash(signature: string): boolean {
  const [flashing, setFlashing] = useState(false);
  const previous = useRef(signature);
  useEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    setFlashing(true);
    const timer = setTimeout(() => {
      setFlashing(false);
    }, UPDATE_FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [signature]);
  return flashing;
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, UPDATE_FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  const copy = (text: string) => {
    // Clipboard needs a secure context (HTTPS or localhost); elsewhere this quietly does nothing.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- missing over plain HTTP
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };
  return [copied, copy];
}

function Metric({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return (
    <div data-mt="metric-row" data-mt-variant={name}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function signalText(card: NodeCardData): string | null {
  if (card.hopsAway === null || card.hopsAway > 0) {
    return card.hopsAway === null ? null : `via ${card.hopsAway} ${hops(card.hopsAway)}`;
  }
  const parts = [
    card.snr === null ? null : `SNR ${card.snr} dB`,
    card.rssi === null ? null : `RSSI ${card.rssi} dBm`,
  ].filter((p) => p !== null);
  return parts.length ? parts.join(" · ") : null;
}

const hops = (n: number) => (n === 1 ? "hop" : "hops");

/** One node at a glance. Focusable: Enter opens the details drawer, `f` toggles favorite. */
export const NodeCard = memo(function NodeCard({
  card,
  origin,
  now,
  thresholds,
  density,
  onFavorite,
}: NodeCardProps) {
  const navigate = useNavigate();
  const flashing = useUpdateFlash(freshness(card));
  const [copied, copy] = useCopied();
  const status = nodeStatus(card.lastHeard, now, thresholds);
  const comfy = density === "comfy";
  const name = card.longName || card.shortName || card.userId;

  const variant = [
    card.isSelf ? "self" : null,
    card.isFavorite ? "favorite" : null,
    card.role ?? null,
  ]
    .filter((v) => v !== null)
    .join(" ");

  const openDm = () => {
    if (!card.isSelf) {
      void navigate({ to: "/dm/$nodeNum", params: { nodeNum: String(card.num) } });
    }
  };
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

  const showDistance = !card.isSelf && origin !== null && card.position !== null;
  const place = [
    showDistance && card.position
      ? `${formatDistance(haversineMeters(origin, card.position))} ${cardinal(
          bearingDegrees(origin, card.position),
        )}`
      : null,
    card.position?.alt != null ? `${card.position.alt} m alt` : null,
  ].filter((p) => p !== null);

  const device = card.device;
  const level = device?.batteryLevel ?? null;
  const signal = card.isSelf ? null : signalText(card);
  const environment = card.environment ? formatEnvironment(card.environment) : null;

  return (
    <article
      data-mt="node-card"
      data-mt-variant={variant}
      data-mt-state={flashing ? "updated" : status}
      data-node-num={card.num}
      tabIndex={0}
      aria-label={`${name}${card.isSelf ? " (my node)" : ""}, ${STATUS_LABELS[status]}`}
      onKeyDown={onKeyDown}
    >
      <header data-mt="node-card-header">
        <span data-mt="status-dot" data-mt-state={status} title={STATUS_LABELS[status]} />
        <span data-mt="node-short-name">{card.shortName}</span>
        <span data-mt="node-long-name" title={name}>
          {name}
        </span>
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
        <div data-mt="node-card-meta">
          {card.role !== null && (
            <span data-mt="role-badge" data-mt-variant={card.role}>
              {roleLabel(card.role)}
            </span>
          )}
          {card.hwModel !== null && (
            <span data-mt="node-hardware" title={card.hwModel}>
              {hardwareLabel(card.hwModel)}
            </span>
          )}
          <button
            type="button"
            data-mt="node-id"
            data-mt-state={copied ? "copied" : "idle"}
            title={copied ? "Copied" : "Copy node ID"}
            onClick={() => {
              copy(card.userId);
            }}
          >
            {card.userId}
          </button>
        </div>
      </header>

      {comfy && <MiniMap position={card.position} isSelf={card.isSelf} num={card.num} />}
      {place.length > 0 && <p data-mt="node-place">{place.join(" · ")}</p>}

      <dl data-mt="node-card-body">
        <Metric name="last-seen" label="Last seen">
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
        </Metric>
        <Metric name="power" label="Power">
          <BatteryMeter level={level} />
          <span data-mt="metric-value">
            {level === null
              ? "—"
              : [
                  level > 100 ? "Powered" : `${level}%`,
                  device?.voltage == null ? null : `${device.voltage.toFixed(2)} V`,
                ]
                  .filter((p) => p !== null)
                  .join(" · ")}
          </span>
          {comfy && <Sparkline points={card.batterySpark} />}
        </Metric>
        {signal !== null && (
          <Metric name="signal" label="Signal">
            {signal}
          </Metric>
        )}
        {!card.isSelf && card.hopsAway !== null && (
          <Metric name="hops" label="Hops">
            {card.hopsAway === 0 ? "Direct" : `${card.hopsAway} ${hops(card.hopsAway)}`}
          </Metric>
        )}
        {device?.channelUtil != null && (
          <Metric name="channel-util" label="Ch util">
            {formatPercent(device.channelUtil)}
          </Metric>
        )}
        {device?.airUtilTx != null && (
          <Metric name="air-util-tx" label="Air TX">
            {formatPercent(device.airUtilTx)}
          </Metric>
        )}
        {device?.uptimeSeconds != null && (
          <Metric name="uptime" label="Uptime">
            {formatDuration(device.uptimeSeconds)}
          </Metric>
        )}
        {environment !== null && (
          <Metric name="environment" label="Env">
            {environment}
          </Metric>
        )}
      </dl>

      <footer data-mt="node-card-actions">
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
          <button type="button" data-mt="button" data-mt-variant="message" onClick={openDm}>
            <MessageSquare data-mt="icon" aria-hidden focusable={false} />
            Message
          </button>
        )}
      </footer>
    </article>
  );
});
