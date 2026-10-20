import { TRAFFIC_WINDOWS, type TrafficDTO, type TrafficWindow } from "@meshterm/shared";
import { format } from "date-fns";
import { useState } from "react";
import { Panel } from "../components/Panel.js";
import { TimeChart, type ChartSeries } from "../components/TimeChart.js";
import { useTraffic } from "../data/queries.js";
import { formatPercent } from "./format.js";

const WINDOW_LABELS: Record<TrafficWindow, string> = {
  "1h": "1 h",
  "6h": "6 h",
  "24h": "24 h",
  "7d": "7 d",
};

const WINDOW_KEY = "meshterm.trafficWindow";

function readWindow(): TrafficWindow {
  try {
    const stored = localStorage.getItem(WINDOW_KEY);
    return (TRAFFIC_WINDOWS as readonly string[]).includes(stored ?? "")
      ? (stored as TrafficWindow)
      : "24h";
  } catch {
    return "24h";
  }
}

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
    {
      id: "channel-util",
      label: "Channel util (my node)",
      kind: "line",
      axis: "right",
      color: "--mt-status-warn",
      values: data.buckets.map((b) => b.channelUtil),
      format: formatPercent,
    },
  ];
}

/** Text alternative for the chart. */
export function trafficSummary(data: TrafficDTO): string {
  const received = data.buckets.reduce((n, b) => n + b.messagesIn, 0);
  const sent = data.buckets.reduce((n, b) => n + b.messagesOut, 0);
  const util = data.buckets.flatMap((b) => (b.channelUtil === null ? [] : [b.channelUtil]));
  const avg = util.length ? formatPercent(util.reduce((a, b) => a + b, 0) / util.length) : null;
  return `${received} received and ${sent} sent${
    avg ? `; my node's channel utilization averaged ${avg}` : "; no utilization reports"
  }.`;
}

/** Messages per bucket and my node's channel utilization, from stored data only. */
export function TrafficPanel({ connectionId }: { connectionId: number }) {
  const [range, setRange] = useState<TrafficWindow>(readWindow);
  const { data, isPending, isError } = useTraffic(connectionId, range);
  const choose = (w: TrafficWindow) => {
    setRange(w);
    try {
      localStorage.setItem(WINDOW_KEY, w);
    } catch {
      // Not remembered.
    }
  };
  const formatTime = (t: number) => format(t, range === "7d" ? "EEE HH:mm" : "HH:mm");

  return (
    <Panel
      variant="traffic"
      title="Network activity"
      actions={
        <div
          data-mt="traffic-window"
          data-mt-variant="segmented"
          role="group"
          aria-label="Time window"
        >
          {TRAFFIC_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              data-mt="segment"
              data-mt-variant={w}
              data-mt-state={w === range ? "active" : "inactive"}
              aria-pressed={w === range}
              onClick={() => {
                choose(w);
              }}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
      }
    >
      {isPending ? (
        <div data-mt="skeleton" data-mt-variant="chart" aria-hidden />
      ) : isError ? (
        <p data-mt="chart-error" role="alert">
          Activity couldn&apos;t be loaded.
        </p>
      ) : (
        <TimeChart
          label={`Messages and channel utilization, last ${WINDOW_LABELS[range]}`}
          summary={trafficSummary(data)}
          times={data.buckets.map((b) => b.time)}
          from={data.from}
          to={data.to}
          bucketMs={data.bucketMs}
          series={trafficSeries(data)}
          formatTime={formatTime}
          emptyText={`No messages or utilization reports in the last ${WINDOW_LABELS[range]}. The chart fills in as MeshTerm records them.`}
        />
      )}
    </Panel>
  );
}
