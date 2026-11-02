import type { MapNodeFeature } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { Crosshair, MessageSquare, PanelRightOpen, X } from "lucide-react";
import { formatAbsolute, formatAgo, formatDuration, formatPercent } from "../dashboard/format.js";
import { STATUS_LABELS } from "../dashboard/insights.js";
import { roleLabel } from "../dashboard/labels.js";
import { nodeStatus } from "../dashboard/view.js";
import { useNodeDetail } from "../data/queries.js";
import { openNodeDetails } from "../data/ui-store.js";
import type { DashboardThresholds } from "@meshterm/shared";

const ICON = { "aria-hidden": true, focusable: false } as const;

interface MapSheetProps {
  connectionId: number | null;
  feature: MapNodeFeature;
  /** "4.6 km NE" from my node, or null. */
  where: string | null;
  thresholds: DashboardThresholds;
  now: number;
  onCenter: () => void;
  onClose: () => void;
}

function hopsText(hops: number | null): string {
  if (hops === null) return "Unknown";
  return hops === 0 ? "Heard directly" : hops === 1 ? "1 hop" : `${hops} hops`;
}

/**
 * The selected node (CR-005 §6.3): a sheet at the bottom of the map with its names,
 * pills, a stat grid and Message / Center / Details. Fields the map's node list doesn't
 * carry (RSSI, channel use, uptime) come from the node's details, as the drawer's do.
 */
export function MapSheet({
  connectionId,
  feature,
  where,
  thresholds,
  now,
  onCenter,
  onClose,
}: MapSheetProps) {
  const p = feature.properties;
  const { data: detail } = useNodeDetail(connectionId, p.num);
  const status = nodeStatus(p.lastHeard, now, thresholds);
  const name = p.longName || p.shortName || p.userId;
  const level = p.batteryLevel;
  const device = detail?.device ?? null;
  const rssi = detail?.rssi ?? null;
  const signal = p.isSelf
    ? "My node"
    : p.hopsAway === 0 && p.snr !== null
      ? `${p.snr} dB`
      : hopsText(p.hopsAway);
  const stats: [string, string, string][] = [
    ["distance", "Distance", p.isSelf ? "—" : (where ?? "Unknown")],
    ["signal", p.hopsAway === 0 || p.isSelf ? "Signal" : "Route", signal],
    ["rssi", "RSSI", rssi === null || p.isSelf ? "—" : `${rssi} dBm`],
    [
      "battery",
      "Battery",
      level === null ? "Unknown" : level > 100 ? "External power" : `${level}%`,
    ],
    [
      "channel-util",
      "Ch util",
      device?.channelUtil == null ? "—" : formatPercent(device.channelUtil),
    ],
    [
      "uptime",
      "Uptime",
      device?.uptimeSeconds == null ? "—" : formatDuration(device.uptimeSeconds),
    ],
  ];
  return (
    <div
      data-mt="map-sheet"
      role="dialog"
      aria-label={name}
      data-node-num={p.num}
      data-mt-state={status}
    >
      <header data-mt="map-sheet-header">
        <span data-mt="callsign-tag" data-mt-variant={p.isSelf ? "self" : undefined}>
          {p.shortName || p.userId.slice(-4)}
        </span>
        <div data-mt="map-sheet-names">
          <span data-mt="map-sheet-title">{name}</span>
          <span data-mt="node-id">{p.userId}</span>
        </div>
        <button type="button" data-mt="icon-button" aria-label="Close" onClick={onClose}>
          <X data-mt="icon" {...ICON} />
        </button>
      </header>
      <div data-mt="map-sheet-pills">
        <span data-mt="map-sheet-pill" data-mt-variant="heard" data-mt-state={status}>
          <span data-mt="status-dot" data-mt-state={status} aria-hidden />
          {p.lastHeard === null ? (
            "Never heard"
          ) : (
            <time
              dateTime={new Date(p.lastHeard).toISOString()}
              title={`${STATUS_LABELS[status]} · ${formatAbsolute(p.lastHeard)}`}
            >
              {formatAgo(p.lastHeard, Math.max(now, p.lastHeard))}
            </time>
          )}
        </span>
        {p.role && (
          <span data-mt="map-sheet-pill" data-mt-variant="role">
            {roleLabel(p.role)}
          </span>
        )}
        {p.precisionMeters !== null && (
          <span data-mt="map-sheet-pill" data-mt-variant="approximate">
            Approximate (±{Math.round(p.precisionMeters / 100) / 10} km)
          </span>
        )}
      </div>
      <dl data-mt="map-sheet-stats">
        {stats.map(([variant, label, value]) => (
          <div key={variant} data-mt="map-sheet-stat" data-mt-variant={variant}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div data-mt="map-sheet-actions">
        {!p.isSelf && (
          <Link
            to="/messages/dm/$nodeId"
            params={{ nodeId: p.userId }}
            data-mt="button"
            data-mt-variant="message"
          >
            <MessageSquare data-mt="icon" {...ICON} />
            Message
          </Link>
        )}
        <button type="button" data-mt="button" data-mt-variant="center" onClick={onCenter}>
          <Crosshair data-mt="icon" {...ICON} />
          Center
        </button>
        <button
          type="button"
          data-mt="button"
          data-mt-variant="details"
          onClick={() => {
            openNodeDetails(p.num);
          }}
        >
          <PanelRightOpen data-mt="icon" {...ICON} />
          Details
        </button>
      </div>
    </div>
  );
}
