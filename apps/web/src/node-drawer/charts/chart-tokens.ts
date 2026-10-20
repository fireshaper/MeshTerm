/**
 * uPlot draws on a canvas, so CSS can't style it. These are the `--mt-chart-*` tokens
 * it uses, resolved to concrete colors from the current theme (like the map's token
 * bridge, map-tokens.ts) and re-read when the theme changes.
 */
export interface ChartTokens {
  /** `--mt-chart-1` … `--mt-chart-6`. */
  series: string[];
  grid: string;
  axis: string;
  crosshair: string;
  /** 0–1: opacity of min–max bands and the "Powered" shading. */
  bandAlpha: number;
  warn: string;
  danger: string;
  powered: string;
  reboot: string;
  font: string;
}

const FALLBACK: ChartTokens = {
  series: ["#55a8ff", "#35d49a", "#a78bfa", "#f472b6", "#5b6878", "#f5b84b"],
  grid: "#26303d",
  axis: "#8b98a8",
  crosshair: "#8b98a8",
  bandAlpha: 0.2,
  warn: "#f5b84b",
  danger: "#f16d79",
  powered: "#35d49a",
  reboot: "#f5b84b",
  font: "ui-monospace, monospace",
};

export function readChartTokens(root: HTMLElement = document.documentElement): ChartTokens {
  if (typeof getComputedStyle !== "function") return FALLBACK;
  const probe = document.createElement("span");
  probe.style.display = "none";
  root.appendChild(probe);
  const color = (token: string, fallback: string) => {
    probe.style.color = "";
    probe.style.color = `var(${token})`;
    const value = getComputedStyle(probe).color;
    return value ? value : fallback;
  };
  try {
    const style = getComputedStyle(root);
    const alpha = Number.parseFloat(style.getPropertyValue("--mt-chart-band-alpha"));
    return {
      series: FALLBACK.series.map((f, i) => color(`--mt-chart-${i + 1}`, f)),
      grid: color("--mt-chart-grid", FALLBACK.grid),
      axis: color("--mt-chart-axis", FALLBACK.axis),
      crosshair: color("--mt-chart-crosshair", FALLBACK.crosshair),
      bandAlpha: Number.isFinite(alpha) && alpha >= 0 && alpha <= 1 ? alpha : FALLBACK.bandAlpha,
      warn: color("--mt-chart-threshold-warn", FALLBACK.warn),
      danger: color("--mt-chart-threshold-danger", FALLBACK.danger),
      powered: color("--mt-chart-powered", FALLBACK.powered),
      reboot: color("--mt-chart-reboot", FALLBACK.reboot),
      font: style.getPropertyValue("--mt-font-mono").trim() || FALLBACK.font,
    };
  } finally {
    probe.remove();
  }
}

/** `rgb(…)`/`rgba(…)`/`#rrggbb` with a new alpha, for canvas fills (bands, shading). */
export function withAlpha(color: string, alpha: number): string {
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(color);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  if (hex) {
    const [r, g, b] = [hex[1], hex[2], hex[3]].map((h) => Number.parseInt(h ?? "0", 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
