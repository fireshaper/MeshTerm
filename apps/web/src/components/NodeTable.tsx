import {
  nodeIdFromNum,
  type CardPosition,
  type DashboardThresholds,
  type NodeCard,
} from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { openNodeDetails } from "../data/ui-store.js";
import { Columns3, Star } from "lucide-react";
import { memo, type ReactNode } from "react";
import { BatteryMeter } from "../dashboard/BatteryMeter.js";
import { formatAbsolute, formatAgo, formatPercent } from "../dashboard/format.js";
import { bearingDegrees, cardinal, formatDistance, haversineMeters } from "../dashboard/geo.js";
import { ageLabel, isStale, STATUS_LABELS } from "../dashboard/insights.js";
import { hardwareLabel, roleLabel } from "../dashboard/labels.js";
import { nodeStatus } from "../dashboard/view.js";

interface Ctx {
  origin: CardPosition | null;
  now: number;
  thresholds: DashboardThresholds;
}

interface Column {
  id: string;
  label: string;
  cell: (card: NodeCard, ctx: Ctx) => ReactNode;
}

const dash = "—";

/** Every optional column; Name is always shown. */
export const COLUMNS: Column[] = [
  { id: "short", label: "Short", cell: (c) => c.shortName || dash },
  { id: "id", label: "ID", cell: (c) => c.userId },
  { id: "role", label: "Role", cell: (c) => (c.role === null ? dash : roleLabel(c.role)) },
  {
    id: "hardware",
    label: "Hardware",
    cell: (c) => (c.hwModel === null ? dash : hardwareLabel(c.hwModel)),
  },
  {
    id: "lastHeard",
    label: "Last heard",
    cell: (c, { now }) =>
      c.lastHeard === null ? (
        "Never"
      ) : (
        <time dateTime={new Date(c.lastHeard).toISOString()} title={formatAbsolute(c.lastHeard)}>
          {formatAgo(c.lastHeard, now)}
        </time>
      ),
  },
  {
    id: "battery",
    label: "Battery",
    cell: (c, { now, thresholds }) => {
      const level = c.device?.batteryLevel ?? null;
      if (level === null) return "Unknown";
      return (
        <span data-mt="cell-battery">
          <BatteryMeter level={level} />
          {level > 100 ? "External" : `${level}%`}
          {c.device && isStale(c.device.time, now, thresholds) && (
            <span data-mt="stale-note">{ageLabel(c.device.time, now)}</span>
          )}
        </span>
      );
    },
  },
  {
    id: "voltage",
    label: "Voltage",
    cell: (c) => (c.device?.voltage == null ? dash : `${c.device.voltage.toFixed(2)} V`),
  },
  // The local node reports SNR 0 for itself; signal to yourself means nothing.
  { id: "snr", label: "SNR", cell: (c) => (c.isSelf || c.snr === null ? dash : `${c.snr} dB`) },
  {
    id: "rssi",
    label: "RSSI",
    cell: (c) => (c.isSelf || c.rssi === null ? dash : `${c.rssi} dBm`),
  },
  {
    id: "hops",
    label: "Hops",
    cell: (c) =>
      c.isSelf || c.hopsAway === null ? dash : c.hopsAway === 0 ? "Direct" : c.hopsAway,
  },
  {
    id: "distance",
    label: "Distance",
    cell: (c, { origin }) =>
      !c.isSelf && origin && c.position
        ? `${formatDistance(haversineMeters(origin, c.position))} ${cardinal(
            bearingDegrees(origin, c.position),
          )}`
        : dash,
  },
  {
    id: "channelUtil",
    label: "Ch util",
    cell: (c) => (c.device?.channelUtil == null ? dash : formatPercent(c.device.channelUtil)),
  },
];

export const DEFAULT_COLUMNS = [
  "short",
  "role",
  "hardware",
  "lastHeard",
  "battery",
  "snr",
  "hops",
  "distance",
];

interface NodeTableProps extends Ctx {
  /** Already filtered and sorted. */
  cards: readonly NodeCard[];
  columns: readonly string[];
  onFavorite: (num: number, favorite: boolean) => void;
}

/** Dense node inventory: one row per node, chosen columns. A row opens the details drawer. */
export function NodeTable({ cards, columns, onFavorite, ...ctx }: NodeTableProps) {
  const shown = COLUMNS.filter((c) => columns.includes(c.id));
  return (
    <div data-mt="node-table-wrap">
      <table data-mt="node-table">
        <caption data-mt="node-count">
          {cards.length} {cards.length === 1 ? "node" : "nodes"}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span data-mt="visually-hidden">Favorite</span>
            </th>
            <th scope="col">Name</th>
            {shown.map((c) => (
              <th key={c.id} scope="col" data-mt-variant={c.id}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <NodeRow key={card.num} card={card} columns={shown} ctx={ctx} onFavorite={onFavorite} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface NodeRowProps {
  card: NodeCard;
  columns: Column[];
  ctx: Ctx;
  onFavorite: (num: number, favorite: boolean) => void;
}

const NodeRow = memo(function NodeRow({ card, columns, ctx, onFavorite }: NodeRowProps) {
  const name = card.longName || card.userId;
  const status = nodeStatus(card.lastHeard, ctx.now, ctx.thresholds);
  const open = () => {
    openNodeDetails(card.num);
  };
  return (
    <tr
      data-mt="node-row"
      data-mt-state={card.isSelf ? "self" : "other"}
      data-mt-variant={status}
      data-node-num={card.num}
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) open();
      }}
    >
      <td data-mt="node-favorite">
        <button
          type="button"
          data-mt="favorite-toggle"
          data-mt-state={card.isFavorite ? "on" : "off"}
          aria-pressed={card.isFavorite}
          aria-label={card.isFavorite ? `Unfavorite ${name}` : `Favorite ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onFavorite(card.num, !card.isFavorite);
          }}
        >
          <Star data-mt="icon" aria-hidden focusable={false} />
        </button>
      </td>
      <th scope="row" data-mt="node-name">
        <span data-mt="status-dot" data-mt-state={status} title={STATUS_LABELS[status]} />
        {card.isSelf ? (
          <>
            {name} <span data-mt="node-self-badge">(you)</span>
          </>
        ) : (
          <Link
            to="/messages/dm/$nodeId"
            params={{ nodeId: nodeIdFromNum(card.num) }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {name}
          </Link>
        )}
      </th>
      {columns.map((c) => (
        <td key={c.id} data-mt={`node-${c.id}`}>
          {c.cell(card, ctx)}
        </td>
      ))}
    </tr>
  );
});

/** Checkbox list of optional columns in a disclosure. */
export function ColumnPicker({
  columns,
  onChange,
}: {
  columns: readonly string[];
  onChange: (columns: string[]) => void;
}) {
  return (
    <details data-mt="column-picker">
      <summary data-mt="column-picker-button">
        <Columns3 data-mt="icon" aria-hidden focusable={false} />
        Columns
      </summary>
      <fieldset data-mt="column-picker-menu">
        <legend data-mt="visually-hidden">Visible columns</legend>
        {COLUMNS.map((c) => (
          <label key={c.id} data-mt="column-option">
            <input
              type="checkbox"
              checked={columns.includes(c.id)}
              onChange={(e) => {
                onChange(
                  e.target.checked
                    ? COLUMNS.filter((x) => x.id === c.id || columns.includes(x.id)).map(
                        (x) => x.id,
                      )
                    : columns.filter((id) => id !== c.id),
                );
              }}
            />
            {c.label}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
