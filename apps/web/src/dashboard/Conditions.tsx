import type { DashboardDTO } from "@meshterm/shared";
import { Panel } from "../components/Panel.js";
import { formatPercent } from "./format.js";
import { gaugeArc, gaugePoint } from "./overview.js";
import { batteryState, levelOf, type Level } from "./view.js";

interface GaugeProps {
  variant: string;
  label: string;
  /** The number in the middle ("12.5", "87", "—"). */
  display: string;
  unit: string;
  /** How full the arc is, 0–1; null draws only the track. */
  fraction: number | null;
  /** A tick at this fraction (a threshold). */
  tick?: number;
  state: Level;
  sub: string;
}

/** A 252° arc gauge (CR-005 §6.2): tokens only, state by threshold. */
export function ArcGauge({
  variant,
  label,
  display,
  unit,
  fraction,
  tick,
  state,
  sub,
}: GaugeProps) {
  const t1 = tick === undefined ? null : gaugePoint(tick, 38);
  const t2 = tick === undefined ? null : gaugePoint(tick, 54);
  return (
    <div data-mt="gauge" data-mt-variant={variant} data-mt-state={state}>
      <svg viewBox="0 0 120 104" role="img" aria-label={`${label}: ${display} ${unit}`}>
        <path data-mt="gauge-track" d={gaugeArc(1)} />
        {fraction !== null && fraction > 0 && <path data-mt="gauge-value" d={gaugeArc(fraction)} />}
        {t1 && t2 && <line data-mt="gauge-tick" x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} />}
        <text data-mt="gauge-number" x="60" y="64" textAnchor="middle">
          {display}
        </text>
        <text data-mt="gauge-unit" x="60" y="80" textAnchor="middle">
          {unit}
        </text>
      </svg>
      <span data-mt="gauge-label">{label}</span>
      <span data-mt="gauge-sub">{sub}</span>
    </div>
  );
}

const BATTERY_LEVELS: Record<ReturnType<typeof batteryState>, Level> = {
  ok: "ok",
  powered: "ok",
  low: "warn",
  critical: "danger",
  unknown: "unknown",
};

/** My node right now: channel utilization, airtime and battery as gauges. */
export function Conditions({ data }: { data: DashboardDTO }) {
  const { summary, thresholds: t, nodes } = data;
  const device = nodes.find((n) => n.isSelf)?.device ?? null;
  const util = device?.channelUtil ?? summary.channelUtil;
  const air = device?.airUtilTx ?? summary.airUtilTx;
  const battery = device?.batteryLevel ?? summary.myBattery;
  const voltage = device?.voltage ?? null;
  const fraction = (v: number | null, max: number) => (v === null ? null : v / max);

  return (
    <Panel variant="conditions" title="Conditions">
      <div data-mt="gauges">
        <ArcGauge
          variant="channel-util"
          label="Ch util"
          display={util === null ? "—" : formatPercent(util).replace("%", "")}
          unit="%"
          fraction={fraction(util, t.channelUtilDanger)}
          tick={t.channelUtilWarn / t.channelUtilDanger}
          state={levelOf(util, t.channelUtilWarn, t.channelUtilDanger)}
          sub={`busy above ${t.channelUtilWarn}%`}
        />
        <ArcGauge
          variant="air-util-tx"
          label="Air TX"
          display={air === null ? "—" : formatPercent(air).replace("%", "")}
          unit="% / h"
          fraction={fraction(air, t.airUtilTxDanger)}
          tick={t.airUtilTxWarn / t.airUtilTxDanger}
          state={levelOf(air, t.airUtilTxWarn, t.airUtilTxDanger)}
          sub="my node, last hour"
        />
        <ArcGauge
          variant="battery"
          label="Battery"
          display={battery === null ? "—" : battery > 100 ? "Ext" : String(battery)}
          unit={battery !== null && battery > 100 ? "power" : "%"}
          fraction={battery === null ? null : Math.min(battery, 100) / 100}
          state={BATTERY_LEVELS[batteryState(battery)]}
          sub={
            voltage === null
              ? battery !== null && battery > 100
                ? "external"
                : "—"
              : `${voltage.toFixed(2)} V`
          }
        />
      </div>
    </Panel>
  );
}
