import { useCallback, useState } from "react";
import { DENSITIES, FILTERS, SORTS, type Density, type Filter, type Sort } from "./view.js";

/** The dashboard's view settings, remembered per browser. */
export interface DashboardPrefs {
  filter: Filter;
  sort: Sort;
  /** Null until the user picks one: then it follows the mesh size (Compact above 150 cards). */
  density: Density | null;
}

export const PREFS_KEY = "meshterm.dashboard";
export const DEFAULT_PREFS: DashboardPrefs = { filter: "all", sort: "lastSeen", density: null };

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T | null) =>
  options.includes(value as T) ? (value as T) : fallback;

/** Stored prefs; anything missing, invalid or unreadable (private mode, blocked storage) falls back. */
export function readPrefs(): DashboardPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
    const r = raw as Record<string, unknown>;
    return {
      filter: oneOf(FILTERS, r.filter, DEFAULT_PREFS.filter) ?? DEFAULT_PREFS.filter,
      sort: oneOf(SORTS, r.sort, DEFAULT_PREFS.sort) ?? DEFAULT_PREFS.sort,
      density: oneOf(DENSITIES, r.density, null),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: DashboardPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted; the page still works.
  }
}

export function useDashboardPrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = useCallback((change: Partial<DashboardPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...change };
      writePrefs(next);
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
