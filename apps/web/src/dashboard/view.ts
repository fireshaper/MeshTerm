import type { DashboardThresholds, NodeCard } from "@meshterm/shared";
import { haversineMeters, type LatLon } from "./geo.js";
import { hardwareLabel } from "./labels.js";

export type NodeStatus = "online" | "recent" | "stale" | "offline";

/** From last heard: online < onlineMin, recent < recentMin, stale < staleMin, else offline. */
export function nodeStatus(
  lastHeard: number | null,
  now: number,
  thresholds: Pick<DashboardThresholds, "onlineMin" | "recentMin" | "staleMin">,
): NodeStatus {
  if (lastHeard === null) return "offline";
  const minutes = (now - lastHeard) / 60_000;
  if (minutes < thresholds.onlineMin) return "online";
  if (minutes < thresholds.recentMin) return "recent";
  if (minutes < thresholds.staleMin) return "stale";
  return "offline";
}

export type Level = "ok" | "warn" | "danger" | "unknown";

/** A percentage against warn/danger levels ("above" the level, as the spec says). */
export function levelOf(value: number | null, warn: number, danger: number): Level {
  if (value === null) return "unknown";
  if (value > danger) return "danger";
  if (value > warn) return "warn";
  return "ok";
}

export type BatteryState = "ok" | "low" | "critical" | "powered" | "unknown";

/** Above 100 % means external power; below 20 % is low, below 10 % critical. */
export function batteryState(level: number | null): BatteryState {
  if (level === null) return "unknown";
  if (level > 100) return "powered";
  if (level < 10) return "critical";
  if (level < 20) return "low";
  return "ok";
}

export const FILTERS = ["all", "online", "favorites", "position"] as const;
export type Filter = (typeof FILTERS)[number];
export const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  online: "Online",
  favorites: "Favorites",
  position: "Has position",
};

export const SORTS = ["lastSeen", "name", "distance", "battery", "hops", "snr"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = {
  lastSeen: "Last seen",
  name: "Name",
  distance: "Distance",
  battery: "Battery",
  hops: "Hops",
  snr: "SNR",
};

export const DENSITIES = ["comfy", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

/** Long name, short name, `!id` (with or without the `!`) and hardware, case-insensitive. */
export function matchesSearch(card: NodeCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    card.longName,
    card.shortName,
    card.userId,
    card.hwModel ?? "",
    card.hwModel ? hardwareLabel(card.hwModel) : "",
  ];
  return haystack.some((s) => s.toLowerCase().includes(q));
}

export function matchesFilter(
  card: NodeCard,
  filter: Filter,
  now: number,
  thresholds: DashboardThresholds,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "online":
      return nodeStatus(card.lastHeard, now, thresholds) === "online";
    case "favorites":
      return card.isFavorite;
    case "position":
      return card.position !== null;
  }
}

/** Nulls sort last whatever the direction. */
function byNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

const displayName = (c: NodeCard) => c.longName || c.shortName || c.userId;

export function distanceFrom(origin: LatLon | null, card: NodeCard): number | null {
  return origin && card.position ? haversineMeters(origin, card.position) : null;
}

/**
 * Comparator for one sort key; ties fall back to last seen, then node number.
 * Battery is lowest first (who needs attention), SNR best first, the rest ascending.
 */
export function compareCards(sort: Sort, origin: LatLon | null) {
  const lastSeen = (a: NodeCard, b: NodeCard) =>
    byNullable(a.lastHeard, b.lastHeard, -1) || a.num - b.num;
  const primary = (a: NodeCard, b: NodeCard): number => {
    switch (sort) {
      case "lastSeen":
        return 0;
      case "name":
        return displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" });
      case "distance":
        return byNullable(distanceFrom(origin, a), distanceFrom(origin, b), 1);
      case "battery":
        return byNullable(a.device?.batteryLevel ?? null, b.device?.batteryLevel ?? null, 1);
      case "hops":
        return byNullable(a.hopsAway, b.hopsAway, 1);
      case "snr":
        return byNullable(a.snr, b.snr, -1);
    }
  };
  return (a: NodeCard, b: NodeCard) => primary(a, b) || lastSeen(a, b);
}

export interface Sections {
  /** My node, when it passes the search and filter. Always shown first. */
  self: NodeCard | null;
  favorites: NodeCard[];
  others: NodeCard[];
}

export interface ViewOptions {
  query: string;
  filter: Filter;
  sort: Sort;
  now: number;
  thresholds: DashboardThresholds;
}

/** Search, filter and sort; then my node first and favorites pinned above everyone else. */
export function arrangeCards(cards: readonly NodeCard[], options: ViewOptions): Sections {
  const self = cards.find((c) => c.isSelf) ?? null;
  const origin = self?.position ?? null;
  const visible = cards
    .filter(
      (c) =>
        matchesSearch(c, options.query) &&
        matchesFilter(c, options.filter, options.now, options.thresholds),
    )
    .sort(compareCards(options.sort, origin));
  return {
    self: visible.find((c) => c.isSelf) ?? null,
    favorites: visible.filter((c) => !c.isSelf && c.isFavorite),
    others: visible.filter((c) => !c.isSelf && !c.isFavorite),
  };
}
