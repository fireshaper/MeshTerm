import type { NodeStatusName } from "@meshterm/shared";

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
