import { SECRET_MASK } from "@meshterm/shared";
import { metaFor } from "./registry.js";

/** A value as the editor shows it (enum labels, units, On/Off); secrets never in clear. */
export function formatValue(path: string, value: unknown): string {
  const meta = metaFor(path);
  if (meta.secret || value === SECRET_MASK) return "••••••••";
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") {
    if (meta.enumLabels?.[value]) return meta.enumLabels[value];
    return value === "" ? "(empty)" : value;
  }
  if (typeof value === "number") return meta.unit ? `${value} ${meta.unit}` : String(value);
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.join(", ");
  return JSON.stringify(value);
}

/** The diff cell for a change: secrets show only that they changed (CR-002 §5.3). */
export function formatChange(path: string, from: unknown, to: unknown): [string, string] {
  if (metaFor(path).secret) return ["", "(changed)"];
  return [formatValue(path, from), formatValue(path, to)];
}
