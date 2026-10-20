// Telemetry and Signal tabs until the uPlot charts (CR-001 Phase C3) replace them:
// the existing SVG charts over `GET …/nodes/:num/history`.
import {
  HISTORY_WINDOWS,
  type HistoryWindow,
  type NodeDetailDTO,
  type NodeHistory,
} from "@meshterm/shared";
import { format } from "date-fns";
import { useState } from "react";
import { TimeChart, type ChartSeries } from "../components/TimeChart.js";
import { useNow } from "../components/useNow.js";
import { formatPercent } from "../dashboard/format.js";
import { useNodeHistory } from "../data/queries.js";

export function historySeries(history: NodeHistory): { times: number[]; series: ChartSeries[] } {
  return {
    times: history.device.map((d) => d.time),
    series: [
      {
        id: "battery",
        label: "Battery",
        kind: "line",
        axis: "left",
        color: "--mt-chart-1",
        // External power reads as > 100: not a battery level.
        values: history.device.map((d) =>
          d.batteryLevel === null || d.batteryLevel > 100 ? null : d.batteryLevel,
        ),
        format: (v) => `${Math.round(v)}%`,
      },
      {
        id: "channel-util",
        label: "Channel util",
        kind: "line",
        axis: "right",
        color: "--mt-status-warn",
        values: history.device.map((d) => d.channelUtil),
        format: formatPercent,
      },
    ],
  };
}

function WindowPicker({
  value,
  onChange,
}: {
  value: HistoryWindow;
  onChange: (w: HistoryWindow) => void;
}) {
  return (
    <div data-mt="range-picker" data-mt-variant="segmented" role="group" aria-label="Range">
      {HISTORY_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          data-mt="segment"
          data-mt-variant={w}
          data-mt-state={w === value ? "active" : "inactive"}
          aria-pressed={w === value}
          onClick={() => {
            onChange(w);
          }}
        >
          {w === "24h" ? "24 h" : "7 d"}
        </button>
      ))}
    </div>
  );
}

const SPAN: Record<HistoryWindow, number> = { "24h": 24 * 3600_000, "7d": 7 * 24 * 3600_000 };
const timeFormat = (w: HistoryWindow) => (t: number) =>
  format(t, w === "7d" ? "EEE HH:mm" : "HH:mm");

export function TelemetryTab({
  connectionId,
  node,
}: {
  connectionId: number;
  node: NodeDetailDTO;
}) {
  const [range, setRange] = useState<HistoryWindow>("24h");
  const now = useNow();
  const { data, isPending, isError } = useNodeHistory(connectionId, node.num, range);
  return (
    <div data-mt="node-drawer-panel" data-mt-variant="telemetry">
      <WindowPicker value={range} onChange={setRange} />
      {node.telemetryKinds.length === 0 ? (
        <p data-mt="chart-empty">
          This node has never sent telemetry. It needs the Telemetry module enabled to report
          battery, utilization or sensor readings.
        </p>
      ) : isPending ? (
        <div data-mt="skeleton" data-mt-variant="chart" aria-hidden />
      ) : isError ? (
        <p role="alert">History couldn&apos;t be loaded.</p>
      ) : (
        <section data-mt="chart-group" data-mt-variant="device">
          <TimeChart
            label={`${node.longName || node.userId}: battery and channel utilization`}
            summary={`${data.device.length} device reports stored in this range.`}
            {...historySeries(data)}
            from={now - SPAN[range]}
            to={now}
            leftMax={100}
            formatTime={timeFormat(range)}
            emptyText="No device telemetry in this range."
          />
        </section>
      )}
    </div>
  );
}

export function SignalTab({ connectionId, node }: { connectionId: number; node: NodeDetailDTO }) {
  const [range, setRange] = useState<HistoryWindow>("24h");
  const now = useNow();
  const { data, isPending, isError } = useNodeHistory(connectionId, node.num, range);
  if (node.isSelf) {
    return (
      <div data-mt="node-drawer-panel" data-mt-variant="signal">
        <p data-mt="chart-empty">
          This is my node: its packets don&apos;t cross the air to itself.
        </p>
      </div>
    );
  }
  return (
    <div data-mt="node-drawer-panel" data-mt-variant="signal">
      <WindowPicker value={range} onChange={setRange} />
      {isPending ? (
        <div data-mt="skeleton" data-mt-variant="chart" aria-hidden />
      ) : isError ? (
        <p role="alert">History couldn&apos;t be loaded.</p>
      ) : (
        <section data-mt="chart-group" data-mt-variant="packets">
          <TimeChart
            label={`Packets heard from ${node.longName || node.userId}`}
            summary={`${data.heard.buckets.reduce((n, b) => n + b.packets, 0)} packets heard in this range.`}
            times={data.heard.buckets.map((b) => b.time)}
            from={data.heard.buckets[0]?.time ?? now - SPAN[range]}
            to={(data.heard.buckets.at(-1)?.time ?? now) + data.heard.bucketMs}
            bucketMs={data.heard.bucketMs}
            series={[
              {
                id: "heard",
                label: "Packets heard",
                kind: "bar",
                axis: "left",
                color: "--mt-chart-1",
                values: data.heard.buckets.map((b) => b.packets),
                format: (v) => `${v} ${v === 1 ? "packet" : "packets"}`,
              },
            ]}
            formatTime={timeFormat(range)}
            emptyText="MeshTerm hasn't heard packets from this node in this range."
          />
        </section>
      )}
      <p data-mt="detail-note">Signal history is kept for 7 days.</p>
    </div>
  );
}
