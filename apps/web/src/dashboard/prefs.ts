import { useCallback, useState } from "react";
import {
  DENSITIES,
  FILTERS,
  POWER_FILTERS,
  SORTS,
  type Density,
  type Filter,
  type PowerFilter,
  type Sort,
} from "./view.js";

export const VIEWS = ["cards", "table"] as const;
export type NodesView = (typeof VIEWS)[number];

/** The Nodes page's view settings, remembered per browser. */
export interface NodePrefs {
  filter: Filter;
  sort: Sort;
  /** Null until the user picks one: then it follows the mesh size (Compact above 150 cards). */
  density: Density | null;
  view: NodesView;
  /** A role enum name; null for all roles. */
  role: string | null;
  power: PowerFilter;
  /** Visible table columns; null for the defaults. */
  columns: string[] | null;
}

export const PREFS_KEY = "meshterm.nodes";
export const DEFAULT_PREFS: NodePrefs = {
  filter: "all",
  sort: "lastSeen",
  density: null,
  view: "cards",
  role: null,
  power: "any",
  columns: null,
};

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | null =>
  options.includes(value as T) ? (value as T) : null;

/** Stored prefs; anything missing, invalid or unreadable (private mode, blocked storage) falls back. */
export function readPrefs(): NodePrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
    const r = raw as Record<string, unknown>;
    return {
      filter: oneOf(FILTERS, r.filter) ?? DEFAULT_PREFS.filter,
      sort: oneOf(SORTS, r.sort) ?? DEFAULT_PREFS.sort,
      density: oneOf(DENSITIES, r.density),
      view: oneOf(VIEWS, r.view) ?? DEFAULT_PREFS.view,
      role: typeof r.role === "string" ? r.role : null,
      power: oneOf(POWER_FILTERS, r.power) ?? DEFAULT_PREFS.power,
      columns:
        Array.isArray(r.columns) && r.columns.every((c) => typeof c === "string")
          ? r.columns
          : null,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: NodePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted; the page still works.
  }
}

export function useNodePrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = useCallback((change: Partial<NodePrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...change };
      writePrefs(next);
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
