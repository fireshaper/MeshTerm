import type { FieldSchema } from "@meshterm/shared";
import type { ComponentProps } from "react";
import type { ConfigField } from "./ConfigField.js";
import { nodeValue, useEditsStore, type ConfigView, type Edit } from "./edits.js";
import type { Getter } from "./registry.js";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface FieldContext {
  connectionId: number | null;
  cfg: ConfigView;
  edits: Record<string, Edit>;
  get: Getter;
  disabled: boolean;
}

/** Everything a `ConfigField` needs for one path: value, edit state, conflict and handlers. */
export function fieldProps(
  ctx: FieldContext,
  path: string,
  field: FieldSchema,
  reboots = false,
): ComponentProps<typeof ConfigField> {
  const { set, reset, rebase } = useEditsStore.getState();
  const edit = ctx.edits[path];
  const current = nodeValue(ctx.cfg, path);
  return {
    path,
    field,
    value: edit ? edit.value : current,
    changed: edit !== undefined,
    was: edit?.base,
    conflict: edit !== undefined && !same(edit.base, current),
    current,
    get: ctx.get,
    disabled: ctx.disabled,
    reboots,
    onChange: (value) => {
      if (ctx.connectionId !== null) set(ctx.connectionId, path, value, current);
    },
    onReset: () => {
      reset(path);
    },
    onKeepMine: () => {
      rebase(path, current);
    },
  };
}

/** Stages a value for a path (no-op without a connection). */
export function stage(ctx: FieldContext, path: string, value: unknown): void {
  if (ctx.connectionId === null) return;
  useEditsStore.getState().set(ctx.connectionId, path, value, nodeValue(ctx.cfg, path));
}

/** A schema entry for fields the editor lays out itself. */
export const scalar = (name: string, kind: FieldSchema["kind"]): FieldSchema => ({
  name,
  kind,
  list: false,
});
