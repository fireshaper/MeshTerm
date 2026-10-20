import {
  TRAFFIC_WINDOWS,
  type NodeCard,
  type TrafficDTO,
  type TrafficWindow,
} from "@meshterm/shared";
import { format } from "date-fns";
import { useState, type ReactNode } from "react";
import { Panel } from "../components/Panel.js";
import { TimeChart, type ChartSeries } from "../components/TimeChart.js";
import { useTraffic } from "../data/queries.js";
import { openNodeDetails } from "../data/ui-store.js";
import { formatPercent } from "./format.js";
import { portLabel } from "./labels.js";

const WINDOW_LABELS: Record<TrafficWindow, string> = {
  "1h": "1 h",
  "6h": "6 h",
  "24h": "24 h",
  "7d": "7 d",
};

export const TRAFFIC_VIEWS = ["packets", "messages"] as const;
export type TrafficView = (typeof TRAFFIC_VIEWS)[number];
const VIEW_LABELS: Record<TrafficView, string> = { packets: "Packets", messages: "Messages" };

const WINDOW_KEY = "meshterm.trafficWindow";
const VIEW_KEY = "meshterm.trafficView";

function readStored<T extends string>(key: string, options: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return options.includes(stored as T) ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
}

const PORT_COLORS = ["--mt-chart-1", "--mt-chart-2", "--mt-chart-3", "--mt-chart-4"];
/** Packet types shown on their own; the rest are "Other". */
export const TOP_PORTS = 4;

const utilSeries = (data: TrafficDTO): ChartSeries => ({
  id: "channel-util",
  label: "Channel util (my node)",
  kind: "line",
  axis: "right",
  color: "--mt-status-warn",
  values: data.buckets.map((b) => b.channelUtil),
  format: formatPercent,
});

export function trafficSeries(data: TrafficDTO): ChartSeries[] {
  const count = (v: number) => `${v} ${v === 1 ? "message" : "messages"}`;
  return [
    {
      id: "messages-in",
      label: "Received",
      kind: "bar",
      axis: "left",
      color: "--mt-chart-1",
      values: data.buckets.map((b) => b.messagesIn),
      format: count,
    },
    {
      id: "messages-out",
      label: "Sent",
      kind: "bar",
      axis: "left",
      color: "--mt-chart-2",
      values: data.buckets.map((b) => b.messagesOut),
      format: count,
    },
    utilSeries(data),
  ];
}

/** Packets per bucket stacked by type: the busiest types on their own, the rest as Other. */
export function packetSeries(data: TrafficDTO): ChartSeries[] {
  const count = (v: number) => `${v} ${v === 1 ? "packet" : "packets"}`;
  const top = data.ports.slice(0, TOP_PORTS).map((p) => p.port);
  const series: ChartSeries[] = top.map((port, i) => ({
    id: `port-${port}`,
    label: portLabel(port),
    kind: "bar",
    axis: "left",
    color: PORT_COLORS[i] ?? "--mt-chart-5",
    values: data.buckets.map((b) => b.packetsByPort[port] ?? 0),
    format: count,
  }));
  if (data.ports.length > TOP_PORTS) {
    series.push({
      id: "port-other",
      label: "Other",
      kind: "bar",
      axis: "left",
      color: "--mt-chart-5",
      values: data.buckets.map(
        (b) => b.packets - top.reduce((n, port) => n + (b.packetsByPort[port] ?? 0), 0),
      ),
      format: count,
    });
  }
  return [...series, utilSeries(data)];
}

const averageUtil = (data: TrafficDTO) => {
  const util = data.buckets.flatMap((b) => (b.channelUtil === null ? [] : [b.channelUtil]));
  return util.length ? formatPercent(util.reduce((a, b) => a + b, 0) / util.length) : null;
};

/** Text alternative for the chart. */
export function trafficSummary(data: TrafficDTO, view: TrafficView = "messages"): string {
  const avg = averageUtil(data);
  const util = avg ? `; my node's channel utilization averaged ${avg}` : "; no utilization reports";
  if (view === "packets") {
    const total = data.buckets.reduce((n, b) => n + b.packets, 0);
    const types = data.ports.map((p) => `${portLabel(p.port)} ${p.packets}`).join(", ");
    return `${total} packets heard${types ? ` (${types})` : ""}${util}.`;
  }
  const received = data.buckets.reduce((n, b) => n + b.messagesIn, 0);
  const sent = data.buckets.reduce((n, b) => n + b.messagesOut, 0);
  return `${received} received and ${sent} sent${util}.`;
}

function Segments<T extends string>({
  hook,
  label,
  options,
  labels,
  value,
  onChange,
}: {
  hook: string;
  label: string;
  options: readonly T[];
  labels: Record<T, ReactNode>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div data-mt={hook} data-mt-variant="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          data-mt="segment"
          data-mt-variant={o}
          data-mt-state={o === value ? "active" : "inactive"}
          aria-pressed={o === value}
          onClick={() => {
            onChange(o);
          }}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

/** The nodes heard most in the window; a name opens its details. */
function BusiestNodes({ data, cards }: { data: TrafficDTO; cards: readonly NodeCard[] }) {
  if (data.topNodes.length === 0) return null;
  const byNum = new Map(cards.map((c) => [c.num, c]));
  const max = data.topNodes[0]?.packets ?? 1;
  return (
    <div data-mt="busiest-nodes">
      <h3 data-mt="busiest-nodes-title">Busiest nodes</h3>
      <ol data-mt="busiest-nodes-list">
        {data.topNodes.map(({ num, packets }) => {
          const card = byNum.get(num);
          return (
            <li key={num} data-mt="busiest-node">
              <button
                type="button"
                data-mt="busiest-node-name"
                onClick={() => {
                  openNodeDetails(num);
                }}
              >
                {card ? card.longName || card.shortName || card.userId : `!${num.toString(16)}`}
              </button>
              <span
                data-mt="usage-bar"
                data-mt-state="ok"
                aria-hidden
                style={{ "--mt-usage": `${Math.round((packets / max) * 100)}%` }}
              >
                <span data-mt="usage-bar-fill" />
              </span>
              <span data-mt="busiest-node-count">
                {packets} {packets === 1 ? "packet" : "packets"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Packets by type or messages per bucket, with my node's channel utilization; stored data only. */
export function TrafficPanel({
  connectionId,
  cards,
}: {
  connectionId: number;
  cards: readonly NodeCard[];
}) {
  const [range, setRange] = useState<TrafficWindow>(() =>
    readStored(WINDOW_KEY, TRAFFIC_WINDOWS, "24h"),
  );
  const [view, setView] = useState<TrafficView>(() =>
    readStored(VIEW_KEY, TRAFFIC_VIEWS, "packets"),
  );
  const { data, isPending, isError } = useTraffic(connectionId, range);
  const formatTime = (t: number) => format(t, range === "7d" ? "EEE HH:mm" : "HH:mm");
  const span = WINDOW_LABELS[range];

  return (
    <Panel
      variant="traffic"
      title="Network activity"
      actions={
        <div data-mt="traffic-controls">
          <Segments
            hook="traffic-view"
            label="Show"
            options={TRAFFIC_VIEWS}
            labels={VIEW_LABELS}
            value={view}
            onChange={(v) => {
              setView(v);
              store(VIEW_KEY, v);
            }}
          />
          <Segments
            hook="traffic-window"
            label="Time window"
            options={TRAFFIC_WINDOWS}
            labels={WINDOW_LABELS}
            value={range}
            onChange={(w) => {
              setRange(w);
              store(WINDOW_KEY, w);
            }}
          />
        </div>
      }
    >
      {isPending ? (
        <div data-mt="skeleton" data-mt-variant="chart" aria-hidden />
      ) : isError ? (
        <p data-mt="chart-error" role="alert">
          Activity couldn&apos;t be loaded.
        </p>
      ) : view === "packets" ? (
        <>
          <TimeChart
            label={`Packets heard by type and channel utilization, last ${span}`}
            summary={trafficSummary(data, "packets")}
            times={data.buckets.map((b) => b.time)}
            from={data.from}
            to={data.to}
            bucketMs={data.bucketMs}
            series={packetSeries(data)}
            formatTime={formatTime}
            emptyText={`No packets heard in the last ${span}. MeshTerm counts packets from other nodes as they arrive.`}
          />
          <BusiestNodes data={data} cards={cards} />
        </>
      ) : (
        <TimeChart
          label={`Messages and channel utilization, last ${span}`}
          summary={trafficSummary(data)}
          times={data.buckets.map((b) => b.time)}
          from={data.from}
          to={data.to}
          bucketMs={data.bucketMs}
          series={trafficSeries(data)}
          formatTime={formatTime}
          emptyText={`No messages or utilization reports in the last ${span}. The chart fills in as MeshTerm records them.`}
        />
      )}
    </Panel>
  );
}
