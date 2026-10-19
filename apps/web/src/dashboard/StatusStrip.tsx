import type { ConnectionState, DashboardDTO } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useNow } from "../components/useNow.js";
import { formatAbsolute, formatAgo, formatDuration, formatPercent } from "./format.js";
import { batteryState, levelOf, nodeStatus, type Level } from "./view.js";

const STATE_LABELS: Record<ConnectionState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  configuring: "Configuring",
  connected: "Connected",
  reconnecting: "Reconnecting",
};

function connectionLevel(state: ConnectionState): Level {
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

interface TileProps {
  variant: string;
  label: string;
  state: Level;
  children: ReactNode;
}

function Tile({ variant, label, state, children }: TileProps) {
  return (
    <div data-mt="status-tile" data-mt-variant={variant} data-mt-state={state}>
      <span data-mt="status-tile-label">{label}</span>
      <span data-mt="status-tile-value">{children}</span>
    </div>
  );
}

interface StatusStripProps {
  data: DashboardDTO;
  /** "Nodes online" sets the Online filter. */
  onShowOnline: () => void;
}

/** The mesh at a glance. Values come from the (live-patched) dashboard data. */
export function StatusStrip({ data, onShowOnline }: StatusStripProps) {
  const now = useNow();
  const { summary, thresholds, nodes } = data;
  const self = nodes.find((n) => n.isSelf) ?? null;
  const device = self?.device ?? null;
  const online = nodes.filter((n) => nodeStatus(n.lastHeard, now, thresholds) === "online").length;
  const battery = device?.batteryLevel ?? summary.myBattery;
  const channelUtil = device?.channelUtil ?? summary.channelUtil;
  const airUtilTx = device?.airUtilTx ?? summary.airUtilTx;
  const state = summary.connectionState;

  return (
    <section data-mt="status-strip" aria-label="Mesh status">
      <Tile variant="connection" label="Connection" state={connectionLevel(state)}>
        {STATE_LABELS[state]}
        {summary.connectedSince !== null && (
          <span data-mt="status-tile-detail">
            {" "}
            {formatDuration((now - summary.connectedSince) / 1000)}
          </span>
        )}
      </Tile>
      <Tile variant="nodes-online" label="Nodes online" state="ok">
        <button type="button" data-mt="status-tile-action" onClick={onShowOnline}>
          {online}/{nodes.length}
        </button>
      </Tile>
      <Tile variant="my-power" label="My power" state={BATTERY_LEVELS[batteryState(battery)]}>
        {battery === null ? "—" : battery > 100 ? "Powered" : `${battery}%`}
      </Tile>
      <Tile
        variant="channel-util"
        label="Channel util"
        state={levelOf(channelUtil, thresholds.channelUtilWarn, thresholds.channelUtilDanger)}
      >
        {channelUtil === null ? "—" : formatPercent(channelUtil)}
      </Tile>
      <Tile
        variant="air-util-tx"
        label="Air util TX"
        state={levelOf(airUtilTx, thresholds.airUtilTxWarn, thresholds.airUtilTxDanger)}
      >
        {airUtilTx === null ? "—" : formatPercent(airUtilTx)}
      </Tile>
      <Tile variant="messages" label="Messages 24 h" state="ok">
        <Link to="/channels/$index" params={{ index: "0" }} data-mt="status-tile-action">
          {summary.messages24h}
        </Link>
      </Tile>
      <LastPacketTile at={summary.lastPacketAt} />
    </section>
  );
}

/** Ticks every second on its own, so the rest of the strip doesn't re-render. */
function LastPacketTile({ at }: { at: number | null }) {
  const now = useNow(1000);
  return (
    <Tile variant="last-packet" label="Last packet" state={at === null ? "unknown" : "ok"}>
      {at === null ? (
        "—"
      ) : (
        <time dateTime={new Date(at).toISOString()} title={formatAbsolute(at)}>
          {formatAgo(at, now)}
        </time>
      )}
    </Tile>
  );
}
