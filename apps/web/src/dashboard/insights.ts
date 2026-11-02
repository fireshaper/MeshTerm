import type { DashboardThresholds, NodeCard } from "@meshterm/shared";
import { formatDuration, formatPercent } from "./format.js";
import { batteryState, nodeStatus, type NodeStatus } from "./view.js";

/**
 * How a node's status reads to people. These describe when we last *heard* the node,
 * not whether it is reachable: a quiet node may be fine, just not transmitting.
 */
export const STATUS_LABELS: Record<NodeStatus, string> = {
  online: "Heard recently",
  recent: "Heard in the last hours",
  stale: "Quiet",
  offline: "Not heard for a day or more",
};

export type SignalQuality = "good" | "fair" | "weak" | "poor" | "unknown";

/** LoRa SNR of the last packet heard directly, in four bands (dB). */
export function signalQuality(snr: number | null): SignalQuality {
  if (snr === null) return "unknown";
  if (snr >= 5) return "good";
  if (snr >= 0) return "fair";
  if (snr >= -7) return "weak";
  return "poor";
}

export const SIGNAL_BARS: Record<SignalQuality, number> = {
  good: 4,
  fair: 3,
  weak: 2,
  poor: 1,
  unknown: 0,
};

/** True when a reading is older than the "recent" threshold, so it should say its age. */
export function isStale(time: number, now: number, thresholds: DashboardThresholds): boolean {
  return now - time >= thresholds.recentMin * 60_000;
}

/** "3h old", for readings that aren't fresh. */
export function ageLabel(time: number, now: number): string {
  return `${formatDuration((now - time) / 1000)} old`;
}

export type AttentionKind = "battery" | "quiet-favorite" | "channel-util" | "air-util-tx";

export interface AttentionItem {
  card: NodeCard;
  kind: AttentionKind;
  severity: "warn" | "danger";
  /** e.g. "Battery 15%". */
  text: string;
}

/**
 * Things worth a look, from reported data only:
 * - low battery (< 20 %, < 10 % is danger) on a node heard within the stale window;
 * - my node or a favorite not heard for longer than the stale threshold;
 * - my node's channel utilization or air util TX above the warn level.
 * Danger first, then my node, then most recently heard.
 */
export function attentionItems(
  cards: readonly NodeCard[],
  now: number,
  thresholds: DashboardThresholds,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const card of cards) {
    const status = nodeStatus(card.lastHeard, now, thresholds);
    const level = card.device?.batteryLevel ?? null;
    const battery = batteryState(level);
    if ((battery === "low" || battery === "critical") && status !== "offline" && level !== null) {
      items.push({
        card,
        kind: "battery",
        severity: battery === "critical" ? "danger" : "warn",
        text: `Battery ${level}%`,
      });
    }
    if ((card.isSelf || card.isFavorite) && card.lastHeard !== null) {
      if (status === "stale" || status === "offline") {
        items.push({
          card,
          kind: "quiet-favorite",
          severity: "warn",
          text: `Not heard for ${formatDuration((now - card.lastHeard) / 1000)}`,
        });
      }
    }
    if (card.isSelf && card.device) {
      const { channelUtil, airUtilTx } = card.device;
      if (channelUtil !== null && channelUtil > thresholds.channelUtilWarn) {
        items.push({
          card,
          kind: "channel-util",
          severity: channelUtil > thresholds.channelUtilDanger ? "danger" : "warn",
          text: `Channel utilization ${formatPercent(channelUtil)}`,
        });
      }
      if (airUtilTx !== null && airUtilTx > thresholds.airUtilTxWarn) {
        items.push({
          card,
          kind: "air-util-tx",
          severity: airUtilTx > thresholds.airUtilTxDanger ? "danger" : "warn",
          text: `Air util TX ${formatPercent(airUtilTx)}`,
        });
      }
    }
  }
  return items.sort(
    (a, b) =>
      Number(b.severity === "danger") - Number(a.severity === "danger") ||
      Number(b.card.isSelf) - Number(a.card.isSelf) ||
      (b.card.lastHeard ?? 0) - (a.card.lastHeard ?? 0) ||
      a.card.num - b.card.num,
  );
}

/** Other nodes (not mine, not favorites) heard within the "recent" window, newest first. */
export function recentlyActive(
  cards: readonly NodeCard[],
  now: number,
  thresholds: DashboardThresholds,
): NodeCard[] {
  return cards
    .filter(
      (c) =>
        !c.isSelf &&
        !c.isFavorite &&
        c.lastHeard !== null &&
        now - c.lastHeard < thresholds.recentMin * 60_000,
    )
    .sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0) || a.num - b.num);
}

/** The battery level a forecast counts down to (the critical line). */
export const FORECAST_TARGET = 10;

export interface BatteryForecast {
  /** Hours until the level reaches `FORECAST_TARGET`, from the last reading. */
  hours: number;
  /** Fitted change per hour (negative). */
  perHour: number;
}

/**
 * When a draining battery hits the critical line (CR-005 §6.6), from a straight-line
 * fit of the readings. Only when it is falling, already under 50 %, the readings span
 * at least two hours and the fit explains most of them (R² ≥ 0.6); otherwise null.
 * Readings above 100 (external power) are left out.
 */
export function batteryForecast(
  points: readonly (readonly [number, number])[],
): BatteryForecast | null {
  const pts = points.filter(([, v]) => v >= 0 && v <= 100);
  if (pts.length < 4) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last || last[0] - first[0] < 2 * 3600_000 || last[1] >= 50) return null;
  const xs = pts.map(([t]) => (t - first[0]) / 3600_000);
  const ys = pts.map(([, v]) => v);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  const r2 = (sxy * sxy) / (sxx * syy);
  if (slope >= 0 || r2 < 0.6) return null;
  const fittedNow = my + slope * ((xs[n - 1] ?? 0) - mx);
  const hours = Math.max(0, (fittedNow - FORECAST_TARGET) / -slope);
  return { hours, perHour: slope };
}
