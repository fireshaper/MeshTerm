import type { SparkPoint } from "@meshterm/shared";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { InfoTip } from "../components/InfoTip.js";
import { Sparkline } from "./BatteryMeter.js";
import type { Level } from "./view.js";

interface MetricCardProps {
  /** `data-mt-variant`: which metric. */
  variant: string;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  /** Context under the value: what it measures, how fresh it is. */
  secondary?: ReactNode;
  state: Level;
  /** Explains the metric (shown as a tooltip). */
  hint?: string;
  /** 0–100 usage bar. */
  meter?: number | null;
  /** Recorded history only; hidden below two points. */
  spark?: readonly SparkPoint[];
  sparkMax?: number;
  sparkLabel?: string;
}

/** One KPI: icon, big value, label, context, state color, optional bar and trend. */
export function MetricCard({
  variant,
  icon: Icon,
  label,
  value,
  secondary,
  state,
  hint,
  meter,
  spark,
  sparkMax,
  sparkLabel,
}: MetricCardProps) {
  return (
    <div data-mt="metric-card" data-mt-variant={variant} data-mt-state={state}>
      <div data-mt="metric-card-top">
        <span data-mt="metric-card-icon">
          <Icon data-mt="icon" aria-hidden focusable={false} />
        </span>
        <span data-mt="metric-card-label">{label}</span>
        {hint !== undefined && <InfoTip label={label} text={hint} />}
      </div>
      <div data-mt="metric-card-value">{value}</div>
      {meter !== undefined && meter !== null && (
        <span
          data-mt="usage-bar"
          data-mt-state={state}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meter}
          style={{ "--mt-usage": `${Math.max(0, Math.min(100, meter))}%` }}
        >
          <span data-mt="usage-bar-fill" />
        </span>
      )}
      <div data-mt="metric-card-bottom">
        {secondary !== undefined && <span data-mt="metric-card-secondary">{secondary}</span>}
        {spark && (
          <Sparkline
            points={spark}
            {...(sparkMax === undefined ? {} : { max: sparkMax })}
            {...(sparkLabel === undefined ? {} : { label: sparkLabel })}
          />
        )}
      </div>
    </div>
  );
}
