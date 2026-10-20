import type { ConnectionState, DashboardDTO } from "@meshterm/shared";
import {
  Activity,
  BatteryMedium,
  Cable,
  MessagesSquare,
  Plug,
  Radio,
  RadioTower,
} from "lucide-react";
import { useNow } from "../components/useNow.js";
import { formatAbsolute, formatAgo, formatDuration, formatPercent } from "./format.js";
import { MetricCard } from "./MetricCard.js";
import { batteryState, levelOf, nodeStatus, type Level } from "./view.js";

export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  configuring: "Configuring",
  connected: "Connected",
  reconnecting: "Reconnecting",
};

export function connectionLevel(state: ConnectionState): Level {
  if (state === "connected") return "ok";
  return state === "disconnected" ? "danger" : "warn";
}

const BATTERY_LEVELS = {
  ok: "ok",
  powered: "ok",
  low: "warn",
  critical: "danger",
  unknown: "unknown",
} as const;

/** "reported 4 min ago" for my node's own readings. */
function reported(time: number | undefined, now: number): string {
  return time === undefined ? "not reported yet" : `reported ${formatAgo(time, now)}`;
}

/** The network at a glance: six KPI cards from the (live-patched) dashboard data. */
export function NetworkKpis({ data }: { data: DashboardDTO }) {
  const now = useNow();
  const { summary, thresholds, nodes } = data;
  const self = nodes.find((n) => n.isSelf) ?? null;
  const device = self?.device ?? null;
  const active = nodes.filter((n) => nodeStatus(n.lastHeard, now, thresholds) === "online").length;
  const battery = device?.batteryLevel ?? summary.myBattery;
  const voltage = device?.voltage ?? null;
  const channelUtil = device?.channelUtil ?? summary.channelUtil;
  const airUtilTx = device?.airUtilTx ?? summary.airUtilTx;
  const utilMax = (danger: number, spark: readonly [number, number][]) =>
    Math.max(danger * 1.2, ...spark.map(([, v]) => v));

  return (
    <section data-mt="kpi-row" aria-label="Network overview">
      <MetricCard
        variant="network-nodes"
        icon={Radio}
        label="Nodes"
        state="ok"
        hint="Nodes are counted as active when a packet from them was heard recently. Not hearing a node doesn't mean it is offline."
        value={
          <>
            {active}
            <span data-mt="metric-card-unit"> / {nodes.length}</span>
          </>
        }
        secondary={`active in ${thresholds.onlineMin} min / known`}
      />
      <MetricCard
        variant="messages"
        icon={MessagesSquare}
        label="Messages"
        state="ok"
        hint="Text messages received from the mesh and sent by you in the last 24 hours, on channels and in direct messages."
        value={summary.messages24h}
        secondary={`${summary.messagesIn24h} received · ${summary.messagesOut24h} sent · 24 h`}
      />
      <MetricCard
        variant="channel-util"
        icon={Activity}
        label="Channel util"
        state={levelOf(channelUtil, thresholds.channelUtilWarn, thresholds.channelUtilDanger)}
        hint={`How busy the radio channel is, as measured by my node (warn above ${thresholds.channelUtilWarn}%, high above ${thresholds.channelUtilDanger}%).`}
        value={channelUtil === null ? "Unknown" : formatPercent(channelUtil)}
        meter={channelUtil}
        secondary={reported(device?.time, now)}
        spark={summary.channelUtilSpark}
        sparkMax={utilMax(thresholds.channelUtilDanger, summary.channelUtilSpark)}
        sparkLabel="Channel utilization over the last 24 hours"
      />
      <MetricCard
        variant="air-util-tx"
        icon={RadioTower}
        label="Airtime TX"
        state={levelOf(airUtilTx, thresholds.airUtilTxWarn, thresholds.airUtilTxDanger)}
        hint={`Share of airtime my node spent transmitting in the last hour (warn above ${thresholds.airUtilTxWarn}%, high above ${thresholds.airUtilTxDanger}%).`}
        value={airUtilTx === null ? "Unknown" : formatPercent(airUtilTx)}
        meter={
          airUtilTx === null ? null : Math.min(100, (airUtilTx / thresholds.airUtilTxDanger) * 100)
        }
        secondary={reported(device?.time, now)}
        spark={summary.airUtilTxSpark}
        sparkMax={utilMax(thresholds.airUtilTxDanger, summary.airUtilTxSpark)}
        sparkLabel="Air util TX over the last 24 hours"
      />
      <MetricCard
        variant="my-power"
        icon={battery !== null && battery > 100 ? Plug : BatteryMedium}
        label="Power"
        hint="My node's battery as it last reported it. A level above 100% means it runs on external power."
        state={BATTERY_LEVELS[batteryState(battery)]}
        value={battery === null ? "Unknown" : battery > 100 ? "External" : `${battery}%`}
        secondary={[
          voltage === null ? null : `${voltage.toFixed(2)} V`,
          reported(device?.time, now),
        ]
          .filter((p) => p !== null)
          .join(" · ")}
        spark={self?.batterySpark ?? []}
        sparkLabel="My battery over the last 24 hours"
      />
      <ConnectionCard data={data} />
    </section>
  );
}

/** Ticks every second on its own (last packet age), so the other cards don't re-render. */
function ConnectionCard({ data }: { data: DashboardDTO }) {
  const now = useNow(1000);
  const { connectionState: state, connectedSince, lastPacketAt } = data.summary;
  return (
    <MetricCard
      variant="connection"
      icon={Cable}
      label="Connection"
      hint="MeshTerm's link to my node. The last packet is when anything last arrived from the node."
      state={connectionLevel(state)}
      value={CONNECTION_LABELS[state]}
      secondary={
        <>
          {connectedSince !== null && (
            <span data-mt="connection-duration">
              for {formatDuration((now - connectedSince) / 1000)} ·{" "}
            </span>
          )}
          {lastPacketAt === null ? (
            "no packets yet"
          ) : (
            <time
              data-mt="last-packet"
              dateTime={new Date(lastPacketAt).toISOString()}
              title={formatAbsolute(lastPacketAt)}
            >
              last packet {formatAgo(lastPacketAt, now)}
            </time>
          )}
        </>
      }
    />
  );
}
