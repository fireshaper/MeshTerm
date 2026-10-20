import type { SparkPoint } from "@meshterm/shared";
import { Plug } from "lucide-react";
import { batteryState } from "./view.js";

/** Battery level bar; `powered` (level > 100) shows a plug instead. */
export function BatteryMeter({ level }: { level: number | null }) {
  const state = batteryState(level);
  if (state === "powered") {
    return (
      <span data-mt="battery-meter" data-mt-state="powered">
        <Plug data-mt="icon" aria-hidden focusable={false} />
      </span>
    );
  }
  const percent = level === null ? 0 : Math.min(100, level);
  return (
    <span
      data-mt="battery-meter"
      data-mt-state={state}
      role="meter"
      aria-label="Battery"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={level ?? undefined}
      style={{ "--mt-battery-fill": `${percent}%` }}
    >
      <span data-mt="battery-meter-fill" />
    </span>
  );
}

const W = 80;
const H = 20;

/** SVG polyline points for a spark: time on x (first to last point), 0–`max` on y. */
export function sparkPoints(points: readonly SparkPoint[], max = 100): string {
  const first = points[0]?.[0] ?? 0;
  const span = (points[points.length - 1]?.[0] ?? first) - first || 1;
  return points
    .map(([t, level]) => {
      const x = ((t - first) / span) * W;
      const y = H - 1 - (Math.max(0, Math.min(max, level)) / max) * (H - 2);
      return `${Number(x.toFixed(1))},${Number(y.toFixed(1))}`;
    })
    .join(" ");
}

interface SparklineProps {
  points: readonly SparkPoint[];
  /** Top of the y scale (100 for percentages); defaults to the larger of 100 and the data. */
  max?: number;
  label?: string;
}

/** A small trend line (24 h by default); nothing with fewer than two points. */
export function Sparkline({
  points,
  max,
  label = "Battery over the last 24 hours",
}: SparklineProps) {
  if (points.length < 2) return null;
  const top = max ?? Math.max(100, ...points.map(([, v]) => v));
  return (
    <svg
      data-mt="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline points={sparkPoints(points, top)} fill="none" stroke="currentColor" />
    </svg>
  );
}
