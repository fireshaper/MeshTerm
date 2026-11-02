import type { DashboardThresholds, NodeDetailDTO } from "@meshterm/shared";
import { batteryForecast, FORECAST_TARGET } from "../dashboard/insights.js";
import { formatDuration } from "../dashboard/format.js";

/** Roles whose job is relaying: a quiet one leaves a hole in the mesh. */
export const RELAY_ROLES = new Set(["ROUTER", "ROUTER_LATE", "REPEATER", "ROUTER_CLIENT"]);

/** A router quiet for this long is worth a note. */
export const SILENT_ROUTER_MS = 2 * 3600_000;

export interface DetailNote {
  kind: "battery-forecast" | "silent-router";
  text: string;
}

/** Plain-language notes for the drawer's Overview (CR-005 §6.6): what needs attention. */
export function detailNotes(
  node: NodeDetailDTO,
  now: number,
  _thresholds: DashboardThresholds,
): DetailNote[] {
  const notes: DetailNote[] = [];
  const forecast = batteryForecast(node.batterySpark);
  if (forecast) {
    const perHour = Math.abs(forecast.perHour);
    notes.push({
      kind: "battery-forecast",
      text: `The battery is falling about ${perHour < 1 ? perHour.toFixed(1) : Math.round(perHour)} % an hour; at this rate it reaches ${FORECAST_TARGET} % in about ${formatDuration(forecast.hours * 3600)}.`,
    });
  }
  if (
    !node.isSelf &&
    node.role !== null &&
    RELAY_ROLES.has(node.role) &&
    node.lastHeard !== null &&
    now - node.lastHeard > SILENT_ROUTER_MS
  ) {
    notes.push({
      kind: "silent-router",
      text: `This router hasn't been heard for ${formatDuration((now - node.lastHeard) / 1000)}. Nodes that relayed through it may be cut off.`,
    });
  }
  return notes;
}
