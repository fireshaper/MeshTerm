import type { FieldSchema } from "@meshterm/shared";
import { RotateCcw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { formatValue } from "./format.js";
import { metaFor, validateField, type Getter } from "./registry.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/** Kinds the editor can change; others (bytes, nested messages, other lists) are shown read-only. */
export function isEditable(field: FieldSchema): boolean {
  if (field.list) return field.kind === "uint" || field.kind === "int";
  return field.kind !== "bytes" && field.kind !== "message";
}

interface ConfigFieldProps {
  path: string;
  field: FieldSchema;
  /** The value shown: the pending edit, else the node's. */
  value: unknown;
  /** A pending edit: the node's value when it was staged is shown as "was:". */
  changed: boolean;
  was: unknown;
  /** The node's value changed under the pending edit (it is `current` now). */
  conflict: boolean;
  current: unknown;
  get: Getter;
  disabled: boolean;
  /** Section-wide: every field of the section reboots the node. */
  reboots: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
  onKeepMine: () => void;
  /** A custom input (e.g. the channel key); gets the id and ARIA attributes to use. */
  renderInput?: (common: InputCommon) => ReactNode;
}

export interface InputCommon {
  id: string;
  disabled: boolean;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

const numberOrNaN = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

function parseList(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .filter((x) => x !== "")
    .map(Number);
}

/** One config field: input by protobuf kind, plus tags, help, warning, "was:" and reset. */
export function ConfigField(props: ConfigFieldProps) {
  const { path, field, value, changed, was, conflict, get, disabled, onChange } = props;
  const meta = metaFor(path);
  const id = `cfg-${path.replaceAll(".", "-")}`;
  const error = changed ? validateField(path, value, get) : null;
  const warning = changed ? (meta.warning?.(value, get) ?? null) : null;
  const readOnly = disabled || meta.readOnly === true || !isEditable(field);
  const states = [changed && "changed", error && "invalid", conflict && "conflict"].filter(Boolean);
  const variant = meta.secret
    ? "secret"
    : meta.danger === "lockout"
      ? "danger-lockout"
      : meta.danger === "warn"
        ? "danger-warn"
        : undefined;
  const describedBy =
    [meta.help && `${id}-help`, error && `${id}-error`, warning && `${id}-warning`]
      .filter(Boolean)
      .join(" ") || undefined;
  const common: InputCommon = {
    id,
    disabled: readOnly,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };

  let input: ReactNode;
  if (props.renderInput) {
    input = props.renderInput(common);
  } else if (meta.control === "slider" && typeof value === "number") {
    input = (
      <input
        type="range"
        {...common}
        min={meta.min}
        max={meta.max}
        step={meta.step ?? 1}
        value={value}
        aria-valuetext={meta.valueText?.(value)}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
      />
    );
  } else if (field.kind === "bool" && !field.list) {
    input = (
      <input
        type="checkbox"
        {...common}
        checked={value === true}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
    );
  } else if (field.kind === "enum" && !field.list) {
    const options = (field.enumValues ?? []).filter(
      (v) => v === value || !meta.hiddenValues?.includes(v),
    );
    input = (
      <select
        {...common}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {options.map((v) => (
          <option key={v} value={v}>
            {meta.enumLabels?.[v] ?? v}
          </option>
        ))}
      </select>
    );
  } else if (field.list && isEditable(field)) {
    input = (
      <input
        type="text"
        inputMode="numeric"
        {...common}
        value={Array.isArray(value) ? value.join(", ") : ""}
        onChange={(e) => {
          onChange(parseList(e.target.value));
        }}
      />
    );
  } else if (field.kind === "int" || field.kind === "uint" || field.kind === "float") {
    input = (
      <input
        type="number"
        {...common}
        min={meta.min ?? (field.kind === "uint" ? 0 : undefined)}
        max={meta.max}
        step={meta.step ?? (field.kind === "float" ? "any" : 1)}
        value={typeof value === "number" && Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          onChange(numberOrNaN(e.target.value));
        }}
      />
    );
  } else if (field.kind === "string" || field.kind === "int64") {
    input = (
      <input
        type={meta.secret ? "password" : "text"}
        {...common}
        inputMode={field.kind === "int64" ? "numeric" : undefined}
        autoComplete="off"
        value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    );
  } else {
    input = (
      <output id={id} data-mt="config-value">
        {formatValue(path, value)}
      </output>
    );
  }

  return (
    <div
      data-mt="config-field"
      data-mt-state={states.join(" ") || undefined}
      data-mt-variant={variant}
      data-path={path}
    >
      <div data-mt="config-field-head">
        <label htmlFor={id} data-mt="config-label">
          {meta.label}
          {meta.unit && <span data-mt="config-unit"> ({meta.unit})</span>}
        </label>
        {(meta.requiresReboot ?? props.reboots) && !readOnly && (
          <span data-mt="reboot-tag">reboot</span>
        )}
        {meta.danger && (
          <span data-mt="danger-tag" data-mt-variant={meta.danger}>
            <TriangleAlert data-mt="icon" {...ICON} />
            <span data-mt="visually-hidden">
              {meta.danger === "lockout" ? "Can lock you out" : "Use with care"}
            </span>
          </span>
        )}
        {changed && (
          <button
            type="button"
            data-mt="icon-button"
            aria-label={`Reset ${meta.label}`}
            title="Reset"
            disabled={disabled}
            onClick={props.onReset}
          >
            <RotateCcw data-mt="icon" {...ICON} />
          </button>
        )}
      </div>
      <div data-mt="config-input">
        {input}
        {meta.valueText && (
          <output data-mt="config-value-text" htmlFor={id}>
            {meta.valueText(value)}
          </output>
        )}
      </div>
      {meta.help && (
        <small data-mt="config-help" id={`${id}-help`}>
          {meta.help}
        </small>
      )}
      {changed && <small data-mt="field-was">was: {formatValue(path, was)}</small>}
      {error && (
        <small data-mt="config-error" id={`${id}-error`}>
          {error}
        </small>
      )}
      {warning && (
        <small data-mt="config-warning" id={`${id}-warning`}>
          {warning}
        </small>
      )}
      {conflict && (
        <div data-mt="config-conflict" role="status">
          <span>Changed on device: now {formatValue(path, props.current)}.</span>
          <button type="button" data-mt="button" disabled={disabled} onClick={props.onReset}>
            Use node&apos;s value
          </button>
          <button type="button" data-mt="button" disabled={disabled} onClick={props.onKeepMine}>
            Keep mine
          </button>
        </div>
      )}
    </div>
  );
}
