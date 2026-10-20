import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";

export interface ChartSeries {
  id: string;
  label: string;
  /** Bars stack on the left axis; lines are drawn on their own axis. */
  kind: "bar" | "line";
  /** One value per entry of `times`; null means no data (a gap, never a zero). */
  values: readonly (number | null)[];
  axis: "left" | "right";
  /** A color token, e.g. `--mt-chart-1`. */
  color: string;
  format: (value: number) => string;
}

export interface TimeChartProps {
  /** Accessible name. */
  label: string;
  /** A one-line text summary for screen readers. */
  summary: string;
  times: readonly number[];
  from: number;
  to: number;
  /** For bucketed data: the bucket width (bars fill it; lines sit at its middle). */
  bucketMs?: number;
  series: readonly ChartSeries[];
  /** Fixed axis tops; otherwise a rounded-up maximum of the data. */
  leftMax?: number;
  rightMax?: number;
  formatTime: (time: number) => string;
  /** Shown instead of the chart when no series has a value. */
  emptyText: string;
}

const W = 600;
const H = 200;

/** 1, 2, 5 × 10ⁿ at or above `value` (never below 1). */
export function niceCeil(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

const pct = (fraction: number) => `${Number((fraction * 100).toFixed(3))}%`;

/**
 * A small time-series chart: stacked bars and/or lines over a time range, with axis
 * labels, a legend, and a hover/keyboard tooltip. Pure SVG, colors from tokens.
 */
export function TimeChart(props: TimeChartProps) {
  const { times, from, to, bucketMs = 0, series, formatTime } = props;
  const [hover, setHover] = useState<number | null>(null);
  const tooltipId = useId();
  const span = to - from || 1;
  const x = (t: number) => ((t - from) / span) * W;
  const center = (t: number) => t + bucketMs / 2;

  const bars = series.filter((s) => s.kind === "bar");
  const lines = series.filter((s) => s.kind === "line");
  const stackTotals = times.map((_, i) => bars.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const leftData = Math.max(
    0,
    ...stackTotals,
    ...lines.filter((s) => s.axis === "left").flatMap((s) => s.values.filter((v) => v !== null)),
  );
  const rightData = Math.max(
    0,
    ...lines.filter((s) => s.axis === "right").flatMap((s) => s.values.filter((v) => v !== null)),
  );
  const leftMax = props.leftMax ?? niceCeil(leftData);
  const rightMax = props.rightMax ?? niceCeil(rightData);
  const y = (value: number, axis: "left" | "right") =>
    H - (Math.max(0, value) / (axis === "left" ? leftMax : rightMax)) * H;

  const hasData = series.some((s) => s.values.some((v) => v !== null && v !== 0));
  if (!hasData) {
    return (
      <div data-mt="chart" data-mt-state="empty">
        <p data-mt="chart-empty">{props.emptyText}</p>
      </div>
    );
  }

  const nearest = (time: number) => {
    let best = 0;
    for (let i = 1; i < times.length; i++) {
      if (Math.abs(center(times[i] ?? 0) - time) < Math.abs(center(times[best] ?? 0) - time)) {
        best = i;
      }
    }
    return best;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    setHover(nearest(from + ((e.clientX - rect.left) / rect.width) * span));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setHover((h) => Math.max(0, Math.min(times.length - 1, (h ?? times.length - 1) + step)));
    } else if (e.key === "Escape") {
      setHover(null);
    }
  };

  /** Line segments split at gaps; a lone point becomes a dot. */
  const segments = (s: ChartSeries) => {
    const out: [number, number][][] = [];
    let current: [number, number][] = [];
    s.values.forEach((v, i) => {
      if (v === null) {
        if (current.length) out.push(current);
        current = [];
        return;
      }
      const t = times[i] ?? 0;
      current.push([x(center(t)), y(v, s.axis)]);
    });
    if (current.length) out.push(current);
    return out;
  };

  const hoverTime = hover === null ? null : (times[hover] ?? null);
  const barWidth = bucketMs > 0 ? (bucketMs / span) * W : W / Math.max(1, times.length);
  const gap = Math.min(2, barWidth * 0.15);

  return (
    <figure data-mt="chart" data-mt-state="ready">
      <div data-mt="chart-body">
        <div data-mt="chart-axis" data-mt-variant="left" aria-hidden>
          <span>
            {bars[0]?.format(leftMax) ?? lines.find((s) => s.axis === "left")?.format(leftMax)}
          </span>
          <span>0</span>
        </div>
        <div
          data-mt="chart-plot"
          role="img"
          aria-label={`${props.label}. ${props.summary}`}
          aria-describedby={hover === null ? undefined : tooltipId}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            setHover(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setHover(null);
          }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden focusable={false}>
            {[0.5, 1].map((f) => (
              <line key={f} data-mt="chart-grid" x1="0" x2={W} y1={H * (1 - f)} y2={H * (1 - f)} />
            ))}
            {times.map((t, i) => {
              let base = H;
              return bars.map((s) => {
                const v = s.values[i] ?? 0;
                if (v <= 0) return null;
                const height = H - y(v, "left");
                base -= height;
                return (
                  <rect
                    key={`${s.id}-${t}`}
                    data-mt="chart-bar"
                    data-mt-variant={s.id}
                    x={x(t) + gap}
                    y={base}
                    width={Math.max(0.5, barWidth - 2 * gap)}
                    height={height}
                    fill={`var(${s.color})`}
                  />
                );
              });
            })}
            {lines.map((s) =>
              segments(s).map((points) => {
                const [px = 0, py = 0] = points[0] ?? [];
                return points.length === 1 ? (
                  <line
                    key={`${s.id}-${px}`}
                    data-mt="chart-dot"
                    data-mt-variant={s.id}
                    x1={px}
                    y1={py}
                    x2={px}
                    y2={py}
                    stroke={`var(${s.color})`}
                  />
                ) : (
                  <polyline
                    key={`${s.id}-${px}`}
                    data-mt="chart-line"
                    data-mt-variant={s.id}
                    points={points.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ")}
                    fill="none"
                    stroke={`var(${s.color})`}
                  />
                );
              }),
            )}
            {hoverTime !== null && (
              <line
                data-mt="chart-guide"
                x1={x(center(hoverTime))}
                x2={x(center(hoverTime))}
                y1="0"
                y2={H}
              />
            )}
          </svg>
          {hover !== null && hoverTime !== null && (
            <div
              data-mt="chart-tooltip"
              id={tooltipId}
              role="tooltip"
              data-mt-variant={x(center(hoverTime)) > W / 2 ? "left" : "right"}
              style={{ "--mt-chart-x": pct(x(center(hoverTime)) / W) }}
            >
              <span data-mt="chart-tooltip-time">{formatTime(hoverTime)}</span>
              {series.map((s) => {
                const v = s.values[hover] ?? null;
                return (
                  <span key={s.id} data-mt="chart-tooltip-row">
                    <span data-mt="chart-swatch" style={{ "--mt-series": `var(${s.color})` }} />
                    {s.label}: {v === null ? "No data" : s.format(v)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {lines.some((s) => s.axis === "right") && (
          <div data-mt="chart-axis" data-mt-variant="right" aria-hidden>
            <span>{lines.find((s) => s.axis === "right")?.format(rightMax)}</span>
            <span>0</span>
          </div>
        )}
      </div>
      <div data-mt="chart-times" aria-hidden>
        <span>{formatTime(from)}</span>
        <span>{formatTime(from + span / 2)}</span>
        <span>{formatTime(to)}</span>
      </div>
      <figcaption data-mt="chart-legend">
        {series.map((s) => (
          <span key={s.id} data-mt="chart-legend-item" data-mt-variant={s.id}>
            <span data-mt="chart-swatch" style={{ "--mt-series": `var(${s.color})` }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
