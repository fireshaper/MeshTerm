import type { NodeStatusName } from "@meshterm/shared";
import type { SignalQuality } from "../dashboard/insights.js";

/**
 * MapLibre paints on a canvas, so CSS can't style its dots and lines. These are the
 * `--mt-map-*` tokens it uses, resolved to concrete colors (and a font) from the
 * current theme.
 */
export interface MapTokens {
  status: Record<NodeStatusName, string>;
  self: string;
  label: string;
  labelHalo: string;
  clusterBg: string;
  clusterText: string;
  font: string;
  /** `--mt-map-node-glow`: opacity (0–1) of a soft halo under each dot; 0 = none (CR-004). */
  glow: number;
  /** Direct links by SNR quality, as signal bars color them (CR-005). */
  quality: Record<SignalQuality, string>;
  /** Range rings: the accent. */
  ring: string;
}

const FALLBACK: MapTokens = {
  status: { online: "#35d49a", recent: "#55a8ff", stale: "#f5b84b", offline: "#5b6878" },
  self: "#f16d79",
  label: "#e8eef5",
  labelHalo: "#0b1018",
  clusterBg: "#55a8ff",
  clusterText: "#0b1018",
  font: "system-ui, sans-serif",
  glow: 0,
  quality: {
    good: "#35d49a",
    fair: "#35d49a",
    weak: "#f5b84b",
    poor: "#f16d79",
    unknown: "#e8eef5",
  },
  ring: "#55a8ff",
};

/**
 * Resolves color tokens through a hidden element, so whatever a theme writes
 * (`var(…)`, `color-mix(…)`, a named color) arrives as `rgb(…)`, which MapLibre parses.
 */
export function readMapTokens(root: HTMLElement = document.documentElement): MapTokens {
  if (typeof getComputedStyle !== "function") return FALLBACK;
  const probe = document.createElement("span");
  probe.style.display = "none";
  root.appendChild(probe);
  const color = (token: string, fallback: string) => {
    probe.style.color = "";
    probe.style.color = `var(${token})`;
    const value = getComputedStyle(probe).color;
    return value && value !== "" ? value : fallback;
  };
  const unit = (value: string) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  };
  try {
    const font = getComputedStyle(root).getPropertyValue("--mt-font-map").trim();
    return {
      status: {
        online: color("--mt-map-node-online", FALLBACK.status.online),
        recent: color("--mt-map-node-recent", FALLBACK.status.recent),
        stale: color("--mt-map-node-stale", FALLBACK.status.stale),
        offline: color("--mt-map-node-offline", FALLBACK.status.offline),
      },
      self: color("--mt-map-marker-self", FALLBACK.self),
      label: color("--mt-map-label", FALLBACK.label),
      labelHalo: color("--mt-map-label-halo", FALLBACK.labelHalo),
      clusterBg: color("--mt-map-cluster-bg", FALLBACK.clusterBg),
      clusterText: color("--mt-map-cluster-text", FALLBACK.clusterText),
      glow: unit(getComputedStyle(root).getPropertyValue("--mt-map-node-glow")),
      quality: {
        good: color("--mt-status-ok", FALLBACK.quality.good),
        fair: color("--mt-status-ok", FALLBACK.quality.fair),
        weak: color("--mt-status-warn", FALLBACK.quality.weak),
        poor: color("--mt-status-error", FALLBACK.quality.poor),
        unknown: color("--mt-map-label", FALLBACK.quality.unknown),
      },
      ring: color("--mt-accent", FALLBACK.ring),
      font: font || FALLBACK.font,
    };
  } finally {
    probe.remove();
  }
}

export interface LabelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  pixelRatio: number;
}

/**
 * A text label as an image for a MapLibre symbol layer. Drawing it ourselves avoids
 * a glyph server (no external font CDN, CSP-friendly) and uses the theme's own font.
 */
export function drawLabel(
  text: string,
  tokens: MapTokens,
  options: { size?: number; bold?: boolean; halo?: boolean } = {},
): LabelImage | null {
  if (typeof document === "undefined") return null;
  const ratio = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
  const size = options.size ?? 12;
  const font = `${options.bold === false ? "" : "600 "}${size * ratio}px ${tokens.font}`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  const pad = 3 * ratio;
  const width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const height = Math.ceil(size * ratio * 1.35) + pad;
  canvas.width = width;
  canvas.height = height;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const x = width / 2;
  const y = height / 2;
  if (options.halo !== false) {
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5 * ratio;
    ctx.strokeStyle = tokens.labelHalo;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = options.halo === false ? tokens.clusterText : tokens.label;
  ctx.fillText(text, x, y);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data, pixelRatio: ratio };
}

/** The teardrop's outline in a 24 × 30 box, tip at the bottom (as on the Overview). */
const PIN_PATH = "M12 29s10-9.5 10-17A10 10 0 0 0 2 12c0 7.5 10 17 10 17z";
export const PIN_WIDTH = 24;
export const PIN_HEIGHT = 30;

/**
 * A teardrop pin in `fill` with a halo outline and a hole, as an image for a symbol
 * layer (CR-005 §6.3). Drawn from tokens, so it follows the theme.
 */
export function drawPin(fill: string, tokens: MapTokens): LabelImage | null {
  if (typeof document === "undefined" || typeof Path2D === "undefined") return null;
  const ratio = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
  const pad = 2;
  const canvas = document.createElement("canvas");
  canvas.width = (PIN_WIDTH + pad * 2) * ratio;
  canvas.height = (PIN_HEIGHT + pad * 2) * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.translate(pad, pad);
  const shape = new Path2D(PIN_PATH);
  ctx.fillStyle = fill;
  ctx.fill(shape);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = tokens.labelHalo;
  ctx.stroke(shape);
  ctx.beginPath();
  ctx.arc(12, 12, 3.6, 0, Math.PI * 2);
  ctx.fillStyle = tokens.labelHalo;
  ctx.fill();
  return {
    width: canvas.width,
    height: canvas.height,
    data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    pixelRatio: ratio,
  };
}
