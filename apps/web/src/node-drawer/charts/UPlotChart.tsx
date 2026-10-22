import type { SeriesDTO } from "@meshterm/shared";
import { createContext, useContext, useEffect, useRef } from "react";
import uPlot from "uplot";
import { withAlpha, type ChartTokens } from "./chart-tokens.js";
import { toChartData } from "./series-data.js";

export interface ChartLine {
  /** Key in the response's `series`. */
  name: string;
  label: string;
  /** Index into `--mt-chart-1…6`. */
  color: number;
  format: (value: number) => string;
  /** y scale; lines on the same scale share an axis. Default `y`. */
  scale?: string;
  stepped?: boolean;
  bars?: boolean;
}

export interface Threshold {
  value: number;
  level: "warn" | "danger";
  label: string;
  scale?: string;
}

export interface ChartSpec {
  id: string;
  title: string;
  lines: ChartLine[];
  /** Fixed y ranges per scale (e.g. battery 0–100). */
  ranges?: Record<string, [number, number]>;
  thresholds?: Threshold[];
  /** Shade where `series.powered` ≥ 0.5 ("Powered", CR-001 §5.4). */
  powered?: boolean;
  /** Mark buckets where `series.reboot` > 0 ("Reboot"). */
  reboots?: boolean;
}

/**
 * Charts of one drawer tab share a crosshair (uPlot cursor sync) and a zoom: dragging
 * in one zooms all, a double-click resets all to the selected range.
 */
export interface ChartSync {
  key: string;
  charts: Set<uPlot>;
  from: number;
  to: number;
}
export const ChartSyncContext = createContext<ChartSync | null>(null);

let syncing = false;

function zoomAll(sync: ChartSync | null, min: number, max: number, source?: uPlot) {
  if (!sync || syncing) return;
  syncing = true;
  try {
    for (const u of sync.charts) if (u !== source) u.setScale("x", { min, max });
  } finally {
    syncing = false;
  }
}

/** The CSS height of the chart box (themes set `--mt-chart-height`). */
const sizeOf = (el: HTMLElement) => ({
  width: Math.max(120, el.clientWidth),
  height: Math.max(80, el.clientHeight),
});

function buildOptions(
  spec: ChartSpec,
  bucketed: boolean,
  tokens: ChartTokens,
  sync: ChartSync | null,
  overlays: { powered: (number | null)[]; reboot: (number | null)[] },
  tooltip: HTMLElement,
  size: { width: number; height: number },
): uPlot.Options {
  const font = `11px ${tokens.font}`;
  const stroke = (line: ChartLine) =>
    tokens.series[line.color % tokens.series.length] ?? tokens.axis;
  const dash = (line: ChartLine) =>
    line.bars ? null : (tokens.dashes[line.color % tokens.dashes.length] ?? null);
  const { bars, stepped } = uPlot.paths;
  const series: uPlot.Series[] = [{}];
  const bands: uPlot.Band[] = [];
  for (const line of spec.lines) {
    const color = stroke(line);
    const lineDash = dash(line);
    series.push({
      label: line.label,
      scale: line.scale ?? "y",
      stroke: color,
      width: 1.5,
      ...(lineDash ? { dash: lineDash } : {}),
      spanGaps: false,
      points: { show: false },
      ...(line.bars && bars
        ? { paths: bars({ size: [0.8, 32] }), fill: withAlpha(color, 0.7) }
        : line.stepped && stepped
          ? { paths: stepped({ align: 1 }) }
          : {}),
    });
    if (bucketed && !line.bars && !line.stepped) {
      const hi = series.length;
      series.push({ scale: line.scale ?? "y", stroke: "transparent", points: { show: false } });
      const lo = series.length;
      series.push({ scale: line.scale ?? "y", stroke: "transparent", points: { show: false } });
      bands.push({ series: [hi, lo], fill: withAlpha(color, tokens.bandAlpha) });
    }
  }

  const scaleKeys = [...new Set(spec.lines.map((l) => l.scale ?? "y"))];
  const scales: uPlot.Scales = { x: { time: true } };
  for (const key of scaleKeys) {
    const fixed = spec.ranges?.[key];
    scales[key] = fixed ? { range: fixed } : { auto: true };
  }
  const axes: uPlot.Axis[] = [
    { stroke: tokens.axis, grid: { stroke: tokens.grid, width: 1 }, ticks: { show: false }, font },
    ...scaleKeys.map((key, i): uPlot.Axis => {
      const line = spec.lines.find((l) => (l.scale ?? "y") === key);
      return {
        scale: key,
        // uPlot.Axis.Side is a const enum with no runtime object: 3 = left, 1 = right.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- see above
        side: i === 0 ? 3 : 1,
        stroke: tokens.axis,
        grid: { show: i === 0, stroke: tokens.grid, width: 1 },
        ticks: { show: false },
        font,
        size: 48,
        values: (_u, splits) => splits.map((v) => (line ? line.format(v) : String(v))),
      };
    }),
  ];

  const draw = (u: uPlot) => {
    const { ctx } = u;
    const { left, top, width, height } = u.bbox;
    const x = u.data[0];
    const ratio = uPlot.pxRatio;
    ctx.save();
    ctx.font = `${10 * ratio}px ${tokens.font}`;
    ctx.textBaseline = "top";
    if (spec.powered) {
      ctx.fillStyle = withAlpha(tokens.powered, tokens.bandAlpha);
      let labelled = false;
      overlays.powered.forEach((v, i) => {
        if (v === null || v < 0.5) return;
        const start = x[i] ?? 0;
        const end = x[i + 1] ?? start + Math.max(1, start - (x[i - 1] ?? start) || 60_000);
        const x0 = u.valToPos(start, "x", true);
        const x1 = u.valToPos(end, "x", true);
        ctx.fillRect(x0, top, Math.max(1, x1 - x0), height);
        if (!labelled) {
          ctx.save();
          ctx.fillStyle = tokens.powered;
          ctx.fillText("Powered", Math.max(left, x0) + 4 * ratio, top + 4 * ratio);
          ctx.restore();
          labelled = true;
        }
      });
    }
    for (const t of spec.thresholds ?? []) {
      const y = u.valToPos(t.value, t.scale ?? "y", true);
      if (y < top || y > top + height) continue;
      ctx.strokeStyle = t.level === "warn" ? tokens.warn : tokens.danger;
      ctx.setLineDash([4 * ratio, 4 * ratio]);
      ctx.lineWidth = ratio;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
    }
    if (spec.reboots) {
      ctx.setLineDash([]);
      ctx.strokeStyle = tokens.reboot;
      ctx.fillStyle = tokens.reboot;
      overlays.reboot.forEach((v, i) => {
        if (!v) return;
        const px = u.valToPos(x[i] ?? 0, "x", true);
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px, top + height);
        ctx.stroke();
        ctx.fillText("Reboot", px + 3 * ratio, top + 4 * ratio);
      });
    }
    ctx.restore();
  };

  const showTooltip = (u: uPlot) => {
    const i = u.cursor.idx;
    const time = i === null || i === undefined ? undefined : u.data[0][i];
    if (i === null || i === undefined || time === undefined) {
      tooltip.hidden = true;
      return;
    }
    const rows: string[] = [new Date(time).toLocaleString()];
    let s = 1;
    for (const line of spec.lines) {
      const v = u.data[s]?.[i];
      const banded = bucketed && !line.bars && !line.stepped;
      const lo = banded ? u.data[s + 2]?.[i] : null;
      const hi = banded ? u.data[s + 1]?.[i] : null;
      if (v !== null && v !== undefined) {
        rows.push(
          `${line.label}: ${line.format(v)}${
            lo != null && hi != null && lo !== hi ? ` (${line.format(lo)}–${line.format(hi)})` : ""
          }`,
        );
      }
      s += banded ? 3 : 1;
    }
    if (rows.length === 1) {
      tooltip.hidden = true;
      return;
    }
    tooltip.replaceChildren(
      ...rows.map((r, k) => {
        const el = document.createElement("span");
        el.dataset.mt = k === 0 ? "chart-tooltip-time" : "chart-tooltip-row";
        el.textContent = r;
        return el;
      }),
    );
    tooltip.hidden = false;
    const left = u.cursor.left ?? 0;
    tooltip.dataset.mtVariant = left > u.over.clientWidth / 2 ? "left" : "right";
    tooltip.style.setProperty("--mt-chart-x", `${left}px`);
  };

  return {
    ...size,
    ms: 1,
    series,
    bands,
    scales,
    axes,
    legend: { show: false },
    cursor: {
      ...(sync ? { sync: { key: sync.key, setSeries: false } } : {}),
      drag: { x: true, y: false },
      points: { show: false },
      // Double-click resets to the selected range (below), not to the data's extent.
      bind: { dblclick: () => () => null },
    },
    hooks: {
      draw: [draw],
      setCursor: [showTooltip],
      setScale: [
        (u, key) => {
          const x = u.scales.x;
          if (key !== "x" || !x || x.min == null || x.max == null) return;
          // A hook for themes and tests: zoomed in, or showing the selected range.
          const zoomed = sync && (x.min > sync.from + 1000 || x.max < sync.to - 1000);
          u.root
            .closest('[data-mt="chart-canvas"]')
            ?.setAttribute("data-mt-state", zoomed ? "zoomed" : "range");
          zoomAll(sync, x.min, x.max, u);
        },
      ],
      ready: [
        (u) => {
          u.over.addEventListener("dblclick", () => {
            if (!sync) return;
            u.setScale("x", { min: sync.from, max: sync.to });
          });
          u.over.addEventListener("mouseleave", () => {
            tooltip.hidden = true;
          });
        },
      ],
    },
  };
}

/** Data for the chart's series: avg (+ max, min when bucketed) per line, gaps broken. */
function chartData(dto: SeriesDTO, spec: ChartSpec) {
  const bucketed = dto.bucketMs > 0;
  const columns: ((number | null)[] | undefined)[] = [];
  for (const line of spec.lines) {
    const s = dto.series[line.name];
    columns.push(s?.avg);
    if (bucketed && !line.bars && !line.stepped) {
      columns.push(s?.max ?? s?.avg);
      columns.push(s?.min ?? s?.avg);
    }
  }
  const all = toChartData(dto, [...columns, dto.series.powered?.avg, dto.series.reboot?.avg]);
  const reboot = all.pop() ?? [];
  const powered = all.pop() ?? [];
  return { data: all as uPlot.AlignedData, overlays: { powered, reboot } };
}

/** One uPlot chart, themed from tokens. Re-created when its spec, shape or theme changes. */
export function UPlotChart({
  dto,
  spec,
  tokens,
  label,
}: {
  dto: SeriesDTO;
  spec: ChartSpec;
  tokens: ChartTokens;
  /** Accessible summary, e.g. "Battery, 24 h: min 61 %, max 98 %, latest 78 %". */
  label: string;
}) {
  const sync = useContext(ChartSyncContext);
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const overlays = useRef<{ powered: (number | null)[]; reboot: (number | null)[] }>({
    powered: [],
    reboot: [],
  });
  const latest = useRef(dto);
  const bucketed = dto.bucketMs > 0;

  useEffect(() => {
    latest.current = dto;
  });

  // (Re)build when the spec, bucketing or theme changes.
  useEffect(() => {
    const el = box.current;
    const tooltip = tip.current;
    if (!el || !tooltip) return;
    const { data, overlays: o } = chartData(latest.current, spec);
    overlays.current.powered = o.powered;
    overlays.current.reboot = o.reboot;
    const u = new uPlot(
      buildOptions(spec, bucketed, tokens, sync, overlays.current, tooltip, sizeOf(el)),
      data,
      el,
    );
    if (sync) {
      u.setScale("x", { min: sync.from, max: sync.to });
      sync.charts.add(u);
    }
    plot.current = u;
    const observer = new ResizeObserver(() => {
      u.setSize(sizeOf(el));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      sync?.charts.delete(u);
      u.destroy();
      plot.current = null;
    };
  }, [spec, bucketed, tokens, sync]);

  // New data (live samples): at most one redraw per second (CR-001 §6.3).
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDraw = useRef(0);
  useEffect(() => {
    const apply = () => {
      pending.current = null;
      lastDraw.current = Date.now();
      const u = plot.current;
      if (!u) return;
      const { data, overlays: o } = chartData(latest.current, spec);
      overlays.current.powered = o.powered;
      overlays.current.reboot = o.reboot;
      const view = u.scales.x;
      u.setData(data, false);
      if (view?.min != null && view.max != null) u.setScale("x", { min: view.min, max: view.max });
    };
    const wait = 1000 - (Date.now() - lastDraw.current);
    if (wait <= 0) apply();
    else pending.current ??= setTimeout(apply, wait);
    return () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [dto, spec]);

  return (
    <div data-mt="chart-canvas" role="img" aria-label={label}>
      <div data-mt="chart-plot" ref={box} />
      <div data-mt="chart-tooltip" ref={tip} hidden aria-hidden />
    </div>
  );
}
