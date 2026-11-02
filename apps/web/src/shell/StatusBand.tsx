import {
  loraSummary,
  type DashboardDTO,
  type DeviceConfigDTO,
  type LoraSummary,
} from "@meshterm/shared";
import type { ReactNode } from "react";
import { useNow } from "../components/useNow.js";
import { formatAgo, formatDuration, formatPercent } from "../dashboard/format.js";
import { batteryState, levelOf, type Level } from "../dashboard/view.js";
import { useConnections, useDashboard, useDeviceConfig } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { StatusPill } from "./StatusPill.js";

const DASH = "—";

const UNKNOWN_LORA: LoraSummary = {
  region: null,
  preset: null,
  sf: null,
  bwKhz: null,
  cr: null,
  slot: null,
  frequencyMhz: null,
};

/** One reading: a mono label over its value; state ok / warn / danger when it matters. */
function Cell({
  field,
  label,
  state,
  title,
  children,
}: {
  field: string;
  label: string;
  state?: Level | undefined;
  title?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div data-mt="status-cell" data-mt-variant={field} data-mt-state={state} title={title}>
      <dt data-mt="status-cell-label">{label}</dt>
      <dd data-mt="status-cell-value">{children}</dd>
    </div>
  );
}

/** The primary channel's name from the config's proto JSON channels ("" when unnamed). */
function primaryChannelName(channels: readonly Record<string, unknown>[] | undefined): string {
  const primary = channels?.find((c) => c.role === "PRIMARY");
  const settings = primary?.settings as { name?: unknown } | undefined;
  return typeof settings?.name === "string" ? settings.name : "";
}

function isConfig(c: unknown): c is DeviceConfigDTO {
  const x = c as Partial<DeviceConfigDTO> | undefined;
  return typeof x?.config === "object" && Array.isArray(x.channels);
}

function isDashboard(d: unknown): d is DashboardDTO {
  const x = d as Partial<DashboardDTO> | undefined;
  return Array.isArray(x?.nodes) && typeof x.summary === "object";
}

/** "TCP 192.168.1.50:4403". */
function useLinkText(): string | null {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data: connections } = useConnections();
  const c = connections?.find((x) => x.id === connectionId);
  return c ? `${c.transport.toUpperCase()} ${c.host}:${c.port}` : null;
}

/**
 * The radio's live readings under the header (CR-005 §6.1), like a radio's faceplate:
 * link, frequency, preset, region, channel use, airtime, battery, last packet and
 * uptime. One row that scrolls sideways when it doesn't fit; a dash for anything not
 * known yet.
 */
export function StatusBand() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data: config } = useDeviceConfig(connectionId);
  const { data: dashboard } = useDashboard(connectionId);
  // The band is on every page: anything odd in a response shows dashes, never an error.
  const dashboardOk = isDashboard(dashboard) ? dashboard : null;
  const link = useLinkText();
  // Before the config arrives everything radio-related is unknown, not the proto defaults.
  const lora = isConfig(config)
    ? loraSummary(config.config.lora ?? null, primaryChannelName(config.channels))
    : UNKNOWN_LORA;

  return (
    <dl data-mt="status-band" aria-label="Radio status">
      <Cell field="link" label="Link">
        <StatusPill />
        {link !== null && <span data-mt="status-cell-detail">{link}</span>}
      </Cell>
      <Cell
        field="freq"
        label="Freq"
        title={lora.slot === null ? undefined : `Frequency slot ${lora.slot}`}
      >
        {lora.frequencyMhz === null ? DASH : `${lora.frequencyMhz} MHz`}
      </Cell>
      <Cell field="preset" label="Preset">
        {lora.preset ?? DASH}
        {lora.sf !== null && lora.bwKhz !== null && (
          <span data-mt="status-cell-detail">
            SF{lora.sf}/BW{lora.bwKhz}
          </span>
        )}
      </Cell>
      <Cell field="region" label="Region">
        {lora.region ?? DASH}
      </Cell>
      <MyNodeCells data={dashboardOk} />
    </dl>
  );
}

/** My node's readings from the dashboard data; the last-packet age ticks every second. */
function MyNodeCells({ data }: { data: DashboardDTO | null }) {
  const now = useNow(1000);
  const self = data?.nodes.find((n) => n.isSelf) ?? null;
  const device = self?.device ?? null;
  const t = data?.thresholds;
  const channelUtil = device?.channelUtil ?? data?.summary.channelUtil ?? null;
  const airUtilTx = device?.airUtilTx ?? data?.summary.airUtilTx ?? null;
  const battery = device?.batteryLevel ?? data?.summary.myBattery ?? null;
  const voltage = device?.voltage ?? null;
  const lastPacket = data?.summary.lastPacketAt ?? null;
  const uptime = device?.uptimeSeconds ?? null;
  const batteryLevel = batteryState(battery);

  return (
    <>
      <Cell
        field="channel-util"
        label="Ch util"
        state={t ? levelOf(channelUtil, t.channelUtilWarn, t.channelUtilDanger) : undefined}
      >
        {channelUtil === null ? DASH : formatPercent(channelUtil)}
      </Cell>
      <Cell
        field="air-util-tx"
        label="Air TX"
        state={t ? levelOf(airUtilTx, t.airUtilTxWarn, t.airUtilTxDanger) : undefined}
      >
        {airUtilTx === null ? DASH : formatPercent(airUtilTx)}
      </Cell>
      <Cell
        field="battery"
        label="Battery"
        state={batteryLevel === "low" ? "warn" : batteryLevel === "critical" ? "danger" : undefined}
      >
        {battery === null ? DASH : battery > 100 ? "External" : `${battery}%`}
        {voltage !== null && <span data-mt="status-cell-detail">{voltage.toFixed(2)} V</span>}
      </Cell>
      <Cell field="last-packet" label="Last packet">
        {lastPacket === null ? DASH : formatAgo(lastPacket, now)}
      </Cell>
      <Cell field="uptime" label="Uptime">
        {uptime === null ? DASH : formatDuration(uptime)}
      </Cell>
    </>
  );
}
