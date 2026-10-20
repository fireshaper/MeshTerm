// Telemetry and Signal tabs (CR-001 §5.4–5.5). A lazy chunk: uPlot loads with it.
import "./charts.css";
import {
  SIGNAL_RETENTION_MS,
  type NodeDetailDTO,
  type SeriesDTO,
  type TelemetryKind,
} from "@meshterm/shared";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNow } from "../../components/useNow.js";
import { useThemeChange } from "../../components/useThemeChange.js";
import { formatDuration } from "../../dashboard/format.js";
import { api } from "../../data/api.js";
import { queryKeys } from "../../data/keys.js";
import { useThresholds } from "../../messages/useNodeMap.js";
import { formatMetric, metricInfo } from "../metrics.js";
import { ICON } from "../parts.js";
import { ChartGroup } from "./ChartGroup.js";
import { readChartTokens, type ChartTokens } from "./chart-tokens.js";
import { RangePicker } from "./RangePicker.js";
import { hasData, PRESET_LABELS, rangeBounds, rangeKey, type NodeRange } from "./series-data.js";
import { ChartSyncContext, type ChartSpec, type ChartSync } from "./UPlotChart.js";

const CSV_MAX_MS = 31 * 24 * 3600_000;

/** Chart colors from the theme, re-read when it changes (no remount, CR-001 §7.2). */
function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState(readChartTokens);
  useThemeChange(() => {
    setTokens(readChartTokens());
  });
  return tokens;
}

const rangeLabel = (range: NodeRange) =>
  range.preset === "custom" ? "custom range" : PRESET_LABELS[range.preset];

/** One crosshair/zoom group per tab and range. */
function useSync(key: string, range: NodeRange, now: number): ChartSync {
  const { from, to } = rangeBounds(range, now);
  // A new group per range (charts rebuild for new data anyway); stable across ticks.
  const rk = rangeKey(range);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `rk` identifies the range
  return useMemo(() => ({ key: `${key}-${rk}`, charts: new Set(), from, to }), [key, rk]);
}

function useSeries(connectionId: number, num: number, kind: TelemetryKind, range: NodeRange) {
  return useQuery({
    queryKey: queryKeys.series(connectionId, num, kind, rangeKey(range)),
    queryFn: ({ signal }) => {
      const { from, to } = rangeBounds(range, Date.now());
      return api.telemetrySeries(connectionId, num, kind, from, to, signal);
    },
    // Live samples keep it current; refetch when reopened after a while.
    staleTime: 60_000,
  });
}

const pct = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}%`;
const metricLine = (name: string, color: number, scale?: string) => ({
  name,
  label: metricInfo(name).label,
  color,
  format: (v: number) => formatMetric(name, v),
  ...(scale ? { scale } : {}),
});
const DERIVED = new Set(["powered", "reboot"]);

/** Chart groups for one kind's response: which charts exist depends on what's present. */
function specsFor(
  kind: TelemetryKind,
  dto: SeriesDTO,
  thresholds: { channelUtilWarn: number; channelUtilDanger: number },
): { group: string; spec: ChartSpec; empty: string | null }[] {
  const names = Object.keys(dto.series).filter((n) => !DERIVED.has(n));
  if (kind === "device") {
    const out: { group: string; spec: ChartSpec; empty: string | null }[] = [];
    if (names.includes("battery_level")) {
      out.push({
        group: "battery",
        empty: null,
        spec: {
          id: "battery",
          title: "Battery",
          lines: [
            {
              name: "battery_level",
              label: "Battery",
              color: 0,
              format: (v) => `${Math.round(v)}%`,
            },
          ],
          ranges: { y: [0, 100] },
          thresholds: [
            { value: 20, level: "warn", label: "20%" },
            { value: 10, level: "danger", label: "10%" },
          ],
          powered: true,
        },
      });
    }
    if (names.includes("voltage")) {
      out.push({
        group: "voltage",
        empty: null,
        spec: { id: "voltage", title: "Voltage", lines: [metricLine("voltage", 1)] },
      });
    }
    const load = ["channel_utilization", "air_util_tx"].filter((n) => names.includes(n));
    if (load.length) {
      out.push({
        group: "radio",
        empty: null,
        spec: {
          id: "radio",
          title: "Radio load",
          lines: load.map((n, i) => ({ ...metricLine(n, i === 0 ? 0 : 3), format: pct })),
          thresholds: [
            { value: thresholds.channelUtilWarn, level: "warn", label: "Channel util warn" },
            { value: thresholds.channelUtilDanger, level: "danger", label: "Channel util danger" },
          ],
        },
      });
    }
    if (names.includes("uptime_seconds")) {
      out.push({
        group: "uptime",
        empty: null,
        spec: {
          id: "uptime",
          title: "Uptime",
          lines: [
            {
              name: "uptime_seconds",
              label: "Uptime",
              color: 4,
              stepped: true,
              format: (v) => formatDuration(v),
            },
          ],
          reboots: true,
        },
      });
    }
    return out;
  }
  if (kind === "power") {
    const channels = new Map<string, string[]>();
    const rest: string[] = [];
    for (const n of names) {
      const m = /^ch(\d+)_(voltage|current)$/.exec(n);
      if (m?.[1]) channels.set(m[1], [...(channels.get(m[1]) ?? []), n]);
      else rest.push(n);
    }
    return [
      ...[...channels.entries()]
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([ch, list]) => ({
          group: `power-ch${ch}`,
          empty: null,
          spec: {
            id: `power-ch${ch}`,
            title: `Channel ${ch}`,
            lines: list
              .sort()
              .reverse()
              .map((n) =>
                metricLine(n, n.endsWith("voltage") ? 1 : 2, n.endsWith("voltage") ? "V" : "mA"),
              ),
          },
        })),
      ...rest.map((n, i) => ({
        group: `power-${n}`,
        empty: null,
        spec: { id: n, title: metricInfo(n).label, lines: [metricLine(n, i)] },
      })),
    ];
  }
  if (kind === "air_quality") {
    const pm = ["pm10_standard", "pm25_standard", "pm100_standard"].filter((n) =>
      names.includes(n),
    );
    const rest = names.filter((n) => !pm.includes(n));
    return [
      ...(pm.length
        ? [
            {
              group: "air-pm",
              empty: null,
              spec: {
                id: "air-pm",
                title: "Particulates",
                lines: pm.map((n, i) => metricLine(n, i)),
              },
            },
          ]
        : []),
      ...rest.map((n, i) => ({
        group: `air-${n}`,
        empty: null,
        spec: { id: n, title: metricInfo(n).label, lines: [metricLine(n, i + 3)] },
      })),
    ];
  }
  // Environment: one small chart per metric the node reports.
  return names.map((n, i) => ({
    group: `env-${n}`,
    empty: null,
    spec: { id: n, title: metricInfo(n).label, lines: [metricLine(n, i)] },
  }));
}

const KIND_TITLES: Record<TelemetryKind, string> = {
  device: "device",
  environment: "environment",
  power: "power-monitor",
  air_quality: "air-quality",
};

function KindCharts({
  connectionId,
  node,
  kind,
  range,
  tokens,
}: {
  connectionId: number;
  node: NodeDetailDTO;
  kind: TelemetryKind;
  range: NodeRange;
  tokens: ChartTokens;
}) {
  const { data, isPending, isError } = useSeries(connectionId, node.num, kind, range);
  const thresholds = useThresholds(connectionId);
  // Re-derive specs only when the set of metrics changes (each spec change rebuilds a chart).
  const signature = data ? Object.keys(data.series).join(",") : "";
  const specs = useMemo(
    () => (data ? specsFor(kind, data, thresholds) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for data's shape
    [kind, signature, thresholds],
  );
  if (isPending) return <div data-mt="skeleton" data-mt-variant="chart" aria-hidden />;
  if (isError) return <p role="alert">Telemetry couldn&apos;t be loaded.</p>;
  if (!hasData(data, Object.keys(data.series))) {
    return (
      <p data-mt="chart-empty" data-mt-variant={kind}>
        No {KIND_TITLES[kind]} telemetry in this range.
      </p>
    );
  }
  return (
    <>
      {specs.map(({ group, spec, empty }) => (
        <ChartGroup
          key={spec.id}
          group={group}
          dto={data}
          spec={spec}
          tokens={tokens}
          rangeLabel={rangeLabel(range)}
          empty={empty}
        />
      ))}
    </>
  );
}

function TabFrame({
  name,
  range,
  onRange,
  children,
  footer,
}: {
  name: string;
  range: NodeRange;
  onRange: (r: NodeRange) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const now = useNow();
  return (
    <div data-mt="node-drawer-panel" data-mt-variant={name}>
      <RangePicker range={range} onChange={onRange} now={now} />
      {children}
      {footer}
    </div>
  );
}

export interface ChartTabProps {
  connectionId: number;
  node: NodeDetailDTO;
  range: NodeRange;
  onRange: (range: NodeRange) => void;
}

export function TelemetryTab({ connectionId, node, range, onRange }: ChartTabProps) {
  const now = useNow();
  const tokens = useChartTokens();
  const sync = useSync(`telemetry-${node.num}`, range, now);
  const { from, to } = rangeBounds(range, now);
  if (node.telemetryKinds.length === 0) {
    return (
      <TabFrame name="telemetry" range={range} onRange={onRange}>
        <p data-mt="chart-empty">
          This node has never sent telemetry. It needs the Telemetry module enabled to report
          battery, utilization or sensor readings.
        </p>
      </TabFrame>
    );
  }
  return (
    <TabFrame
      name="telemetry"
      range={range}
      onRange={onRange}
      footer={
        to - from <= CSV_MAX_MS ? (
          <a
            data-mt="button"
            data-mt-variant="export-csv"
            href={api.telemetryCsvUrl(connectionId, node.num, Math.round(from), Math.round(to))}
            download
          >
            <Download data-mt="icon" {...ICON} />
            Export CSV
          </a>
        ) : (
          <p data-mt="detail-note">CSV exports cover up to 31 days.</p>
        )
      }
    >
      <ChartSyncContext.Provider value={sync}>
        {node.telemetryKinds.map((kind) => (
          <KindCharts
            key={kind}
            connectionId={connectionId}
            node={node}
            kind={kind}
            range={range}
            tokens={tokens}
          />
        ))}
      </ChartSyncContext.Provider>
    </TabFrame>
  );
}

export function SignalTab({ connectionId, node, range, onRange }: ChartTabProps) {
  const now = useNow();
  const tokens = useChartTokens();
  const sync = useSync(`signal-${node.num}`, range, now);
  const { from, to } = rangeBounds(range, now);
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.signal(connectionId, node.num, rangeKey(range)),
    queryFn: ({ signal }) => {
      const b = rangeBounds(range, Date.now());
      return api.signalSeries(connectionId, node.num, b.from, b.to, signal);
    },
    staleTime: 60_000,
    enabled: !node.isSelf,
  });
  const specs = useMemo<ChartSpec[]>(
    () => [
      {
        id: "snr",
        title: "SNR (heard directly)",
        lines: [{ name: "snr", label: "SNR", color: 0, format: (v) => `${v.toFixed(1)} dB` }],
      },
      {
        id: "rssi",
        title: "RSSI (heard directly)",
        lines: [{ name: "rssi", label: "RSSI", color: 1, format: (v) => `${Math.round(v)} dBm` }],
      },
      {
        id: "hops",
        title: "Hops away",
        lines: [
          {
            name: "hops",
            label: "Hops",
            color: 2,
            stepped: true,
            format: (v) => v.toFixed(v % 1 ? 1 : 0),
          },
        ],
      },
    ],
    [],
  );
  const rateSpec = useMemo<ChartSpec>(
    () => ({
      id: "packets",
      title: "Packets heard",
      lines: [
        {
          name: "packets",
          label: "Packets",
          color: 3,
          bars: true,
          format: (v) => `${Math.round(v)}`,
        },
      ],
    }),
    [],
  );
  if (node.isSelf) {
    return (
      <TabFrame name="signal" range={range} onRange={onRange}>
        <p data-mt="chart-empty">
          This is my node: its packets don&apos;t cross the air to itself.
        </p>
      </TabFrame>
    );
  }
  const note =
    to - from > SIGNAL_RETENTION_MS ? (
      <p data-mt="detail-note">Signal history is kept for 7 days.</p>
    ) : null;
  const rate: SeriesDTO | null = data
    ? {
        kind: "rate",
        from: data.from,
        to: data.to,
        bucketMs: 0,
        t: data.rate.t,
        count: data.rate.packets.map(() => 1),
        series: { packets: { avg: data.rate.packets } },
      }
    : null;
  return (
    <TabFrame name="signal" range={range} onRange={onRange} footer={note}>
      {isPending ? (
        <div data-mt="skeleton" data-mt-variant="chart" aria-hidden />
      ) : isError ? (
        <p role="alert">Signal history couldn&apos;t be loaded.</p>
      ) : (
        <ChartSyncContext.Provider value={sync}>
          {specs.map((spec) => (
            <ChartGroup
              key={spec.id}
              group={spec.id}
              dto={data}
              spec={spec}
              tokens={tokens}
              rangeLabel={rangeLabel(range)}
              empty={
                spec.id === "hops"
                  ? "MeshTerm hasn't heard this node in this range."
                  : "Not heard directly in this range: SNR and RSSI describe the last relay otherwise."
              }
            />
          ))}
          {rate && (
            <ChartGroup
              group="packets"
              dto={rate}
              spec={rateSpec}
              tokens={tokens}
              rangeLabel={rangeLabel(range)}
              empty="No packets heard in this range."
            />
          )}
        </ChartSyncContext.Provider>
      )}
    </TabFrame>
  );
}
