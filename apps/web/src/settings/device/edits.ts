import type { ConfigChanges, DeviceConfigDTO } from "@meshterm/shared";
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

/** The node's value at `owner.x` / `config.<section>.x` / `moduleConfig.<section>.x`. */
export function nodeValue(cfg: DeviceConfigDTO | undefined, path: string): unknown {
  if (!cfg) return undefined;
  const [kind, a, b] = path.split(".");
  if (kind === "owner") return a === undefined ? undefined : cfg.owner?.[a];
  const sections = kind === "config" ? cfg.config : kind === "moduleConfig" ? cfg.moduleConfig : {};
  if (a === undefined || b === undefined) return undefined;
  return sections[a]?.[b];
}

/** A getter for conditions and validation: pending edit if any, else the node's value. */
export function getterFor(cfg: DeviceConfigDTO | undefined, edits: Record<string, Edit>): Getter {
  return (path) => (path in edits ? edits[path]?.value : nodeValue(cfg, path));
}

/** The apply body for the staged edits: partial sections, merged server-side. */
export function buildChanges(edits: Record<string, Edit>): ConfigChanges {
  const out: {
    owner?: Record<string, unknown>;
    config?: Record<string, Record<string, unknown>>;
    moduleConfig?: Record<string, Record<string, unknown>>;
  } = {};
  for (const [path, { value }] of Object.entries(edits)) {
    const [kind, a, b] = path.split(".");
    if (a === undefined) continue;
    if (kind === "owner") {
      out.owner = { ...out.owner, [a]: value };
    } else if ((kind === "config" || kind === "moduleConfig") && b !== undefined) {
      const sections = (out[kind] ??= {});
      sections[a] = { ...sections[a], [b]: value };
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
  cfg: DeviceConfigDTO | undefined,
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
  // An unset region blocks every other LoRa change (CR-002 §7.2).
  const region = "config.lora.region";
  if (summary.bySection.lora && get(region) === "UNSET" && !summary.invalid.includes(region)) {
    summary.invalid.push(region);
  }
  return summary;
}
