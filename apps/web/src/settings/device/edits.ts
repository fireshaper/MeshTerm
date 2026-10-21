import type { ConfigChanges, DeviceConfigDTO, FixedPosition, ProtoJson } from "@meshterm/shared";
import { create } from "zustand";
import { metaFor, sectionOf, validateField, type Getter } from "./registry.js";

/** A staged change: the value to send and the node's value when it was staged. */
export interface Edit {
  value: unknown;
  base: unknown;
}

export interface EditsState {
  connectionId: number | null;
  edits: Record<string, Edit>;
  /** The apply this browser started; its edits are cleared once it lands. */
  applyId: string | null;
  setApplyId: (id: string | null) => void;
  set: (connectionId: number, path: string, value: unknown, base: unknown) => void;
  reset: (path: string) => void;
  /** "Use node's value" after a conflict: drop the edit. "Keep mine": rebase it. */
  rebase: (path: string, base: unknown) => void;
  clear: () => void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const without = (edits: Record<string, Edit>, path: string) =>
  Object.fromEntries(Object.entries(edits).filter(([p]) => p !== path));

export const useEditsStore = create<EditsState>()((set) => ({
  connectionId: null,
  edits: {},
  applyId: null,
  setApplyId: (applyId) => {
    set({ applyId });
  },
  set: (connectionId, path, value, base) => {
    set((s) => {
      const edits = s.connectionId === connectionId ? s.edits : {};
      const prior = edits[path];
      const origin = prior ? prior.base : base;
      // Back to the node's value: no longer an edit.
      return {
        connectionId,
        edits: same(value, origin)
          ? without(edits, path)
          : { ...edits, [path]: { value, base: origin } },
      };
    });
  },
  reset: (path) => {
    set((s) => ({ edits: without(s.edits, path) }));
  },
  rebase: (path, base) => {
    set((s) => {
      const edit = s.edits[path];
      if (!edit) return s;
      return { edits: { ...s.edits, [path]: { value: edit.value, base } } };
    });
  },
  clear: () => {
    set({ edits: {}, applyId: null });
  },
}));

/** The node's config plus its current position (what a fixed position starts from). */
export type ConfigView = DeviceConfigDTO & { fixedPosition?: FixedPosition | null };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The channel in slot `index` (proto JSON); slots the node didn't report are disabled. */
export function channelAt(cfg: ConfigView | undefined, index: number): ProtoJson {
  return (
    cfg?.channels.find((c) => (c.index ?? 0) === index) ?? {
      index,
      role: "DISABLED",
      settings: {},
    }
  );
}

/**
 * The node's value at a path: `owner.x`, `config.<section>.x`, `moduleConfig.<section>.x`,
 * `channels.<index>.settings.x…` or `fixedPosition.lat|lon|alt`.
 */
export function nodeValue(cfg: ConfigView | undefined, path: string): unknown {
  if (!cfg) return undefined;
  const parts = path.split(".");
  const [kind, a] = parts;
  let cur: unknown;
  let rest: string[];
  if (kind === "owner") {
    cur = cfg.owner;
    rest = parts.slice(1);
  } else if ((kind === "config" || kind === "moduleConfig") && a !== undefined) {
    cur = cfg[kind][a];
    rest = parts.slice(2);
  } else if (kind === "channels" && a !== undefined) {
    cur = cfg.channels.find((c) => (c.index ?? 0) === Number(a));
    rest = parts.slice(2);
  } else if (kind === "fixedPosition") {
    cur = cfg.fixedPosition;
    rest = parts.slice(1);
  } else {
    return undefined;
  }
  for (const key of rest) cur = isObject(cur) ? cur[key] : undefined;
  return cur;
}

function setDeep(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  const [key, ...more] = keys;
  if (key === undefined) return;
  if (more.length === 0) {
    obj[key] = value;
    return;
  }
  const next = isObject(obj[key]) ? obj[key] : {};
  obj[key] = next;
  setDeep(next, more, value);
}

/** A getter for conditions and validation: pending edit if any, else the node's value. */
export function getterFor(cfg: ConfigView | undefined, edits: Record<string, Edit>): Getter {
  return (path) => (path in edits ? edits[path]?.value : nodeValue(cfg, path));
}

/**
 * The apply body for the staged edits: partial sections (merged server-side), whole
 * channels (the node's channel with the edits on top), and the fixed position.
 */
export function buildChanges(edits: Record<string, Edit>, cfg?: ConfigView): ConfigChanges {
  const out: {
    owner?: Record<string, unknown>;
    config?: Record<string, Record<string, unknown>>;
    moduleConfig?: Record<string, Record<string, unknown>>;
    channels?: ProtoJson[];
    fixedPosition?: FixedPosition | null;
  } = {};
  const channels = new Map<number, ProtoJson>();
  let position = false;
  for (const [path, { value }] of Object.entries(edits)) {
    const parts = path.split(".");
    const [kind, a, b] = parts;
    if (a === undefined) continue;
    if (kind === "owner") {
      out.owner = { ...out.owner, [a]: value };
    } else if ((kind === "config" || kind === "moduleConfig") && b !== undefined) {
      const sections = (out[kind] ??= {});
      sections[a] = { ...sections[a], [b]: value };
    } else if (kind === "channels") {
      const index = Number(a);
      const channel = channels.get(index) ?? structuredClone(channelAt(cfg, index));
      setDeep(channel, parts.slice(2), value);
      channels.set(index, channel);
    } else if (kind === "fixedPosition") {
      position = true;
    }
  }
  if (channels.size > 0) {
    out.channels = [...channels.entries()].sort(([x], [y]) => x - y).map(([, c]) => c);
  }
  const get = getterFor(cfg, edits);
  const fixed = get("config.position.fixedPosition");
  if ("config.position.fixedPosition" in edits && fixed === false) {
    out.fixedPosition = null;
  } else if (position || ("config.position.fixedPosition" in edits && fixed === true)) {
    const lat = get("fixedPosition.lat");
    const lon = get("fixedPosition.lon");
    const alt = get("fixedPosition.alt");
    if (typeof lat === "number" && typeof lon === "number") {
      out.fixedPosition = {
        lat,
        lon,
        ...(typeof alt === "number" ? { alt: Math.round(alt) } : {}),
      };
    }
  }
  return out;
}

export interface EditSummary {
  count: number;
  /** Section id → number of edits. */
  bySection: Record<string, number>;
  reboot: boolean;
  /** Paths whose value is invalid. */
  invalid: string[];
  /** Paths whose node value changed since they were staged. */
  conflicts: string[];
  lockout: string[];
}

export function summarize(
  cfg: ConfigView | undefined,
  edits: Record<string, Edit>,
  rebootingSections: ReadonlySet<string>,
): EditSummary {
  const get = getterFor(cfg, edits);
  const summary: EditSummary = {
    count: 0,
    bySection: {},
    reboot: false,
    invalid: [],
    conflicts: [],
    lockout: [],
  };
  for (const [path, edit] of Object.entries(edits)) {
    const section = sectionOf(path);
    const meta = metaFor(path);
    summary.count += 1;
    summary.bySection[section] = (summary.bySection[section] ?? 0) + 1;
    if (meta.requiresReboot || rebootingSections.has(section)) summary.reboot = true;
    if (validateField(path, edit.value, get)) summary.invalid.push(path);
    if (cfg && !same(nodeValue(cfg, path), edit.base)) summary.conflicts.push(path);
    if (meta.danger === "lockout" && meta.warning?.(edit.value, get)) summary.lockout.push(path);
  }
  // A fixed position needs coordinates (CR-002 §5.6).
  const touched = Object.keys(edits).some(
    (p) => p.startsWith("fixedPosition.") || p === "config.position.fixedPosition",
  );
  if (touched && get("config.position.fixedPosition") === true) {
    for (const p of ["fixedPosition.lat", "fixedPosition.lon"]) {
      if (typeof get(p) !== "number" && !summary.invalid.includes(p)) summary.invalid.push(p);
    }
  }
  // An unset region blocks every other LoRa change (CR-002 §7.2).
  const region = "config.lora.region";
  if (summary.bySection.lora && get(region) === "UNSET" && !summary.invalid.includes(region)) {
    summary.invalid.push(region);
  }
  return summary;
}
