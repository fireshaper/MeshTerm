import type { SeriesDTO } from "@meshterm/shared";
import { useState } from "react";
import { summarize } from "./series-data.js";
import { UPlotChart, type ChartSpec } from "./UPlotChart.js";
import type { ChartTokens } from "./chart-tokens.js";

/** "Battery, 24 h: min 61%, max 98%, latest 78%" for each line, for screen readers. */
export function chartSummary(dto: SeriesDTO, spec: ChartSpec, rangeLabel: string): string {
  const parts = spec.lines.map((line) => {
    const s = summarize(dto, line.name);
    if (s.latest === null && s.min === null) return `${line.label}: no data`;
    return [
      line.label,
      s.min === null ? null : `min ${line.format(s.min)}`,
      s.max === null ? null : `max ${line.format(s.max)}`,
      s.latest === null ? null : `latest ${line.format(s.latest)}`,
    ]
      .filter(Boolean)
      .join(" ");
  });
  return `${spec.title}, ${rangeLabel}: ${parts.join("; ")}`;
}

function ChartTable({ dto, spec }: { dto: SeriesDTO; spec: ChartSpec }) {
  const rows = dto.t
    .map((t, i) => ({ t, values: spec.lines.map((l) => dto.series[l.name]?.avg[i] ?? null) }))
    .filter((r) => r.values.some((v) => v !== null))
    .reverse();
  return (
    <div data-mt="chart-table-wrap">
      <table data-mt="chart-table">
        <caption data-mt="visually-hidden">{spec.title}</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            {spec.lines.map((l) => (
              <th key={l.name} scope="col">
                {l.label}
                {dto.bucketMs > 0 ? " (avg)" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t}>
              <th scope="row">{new Date(r.t).toLocaleString()}</th>
              {r.values.map((v, i) => (
                <td key={spec.lines[i]?.name ?? i}>
                  {v === null ? "—" : (spec.lines[i]?.format(v) ?? String(v))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One chart with its title, legend, empty state and "View as table" toggle. */
export function ChartGroup({
  group,
  dto,
  spec,
  tokens,
  rangeLabel,
  empty,
}: {
  /** `data-mt-variant`, e.g. `battery`, `environment`. */
  group: string;
  dto: SeriesDTO;
  spec: ChartSpec;
  tokens: ChartTokens;
  rangeLabel: string;
  /** Shown instead of the chart when there's no data in range; null hides the group. */
  empty: string | null;
}) {
  const [table, setTable] = useState(false);
  const hasValues =
    spec.lines.some((l) => dto.series[l.name]?.avg.some((v) => v !== null)) ||
    (spec.powered === true && (dto.series.powered?.avg.some((v) => (v ?? 0) >= 0.5) ?? false));
  if (!hasValues && empty === null) return null;
  return (
    <section
      data-mt="chart-group"
      data-mt-variant={group}
      data-mt-state={hasValues ? "ready" : "empty"}
    >
      <header data-mt="chart-group-header">
        <h4 data-mt="chart-title">{spec.title}</h4>
        <ul data-mt="chart-legend" aria-hidden>
          {spec.lines.length > 1 &&
            spec.lines.map((l) => (
              <li key={l.name} data-mt="chart-legend-item">
                <span
                  data-mt="chart-swatch"
                  style={{ "--mt-series": `var(--mt-chart-${(l.color % 6) + 1})` }}
                />
                {l.label}
              </li>
            ))}
        </ul>
        {hasValues && (
          <button
            type="button"
            data-mt="chart-table-toggle"
            aria-pressed={table}
            onClick={() => {
              setTable(!table);
            }}
          >
            {table ? "View as chart" : "View as table"}
          </button>
        )}
      </header>
      {!hasValues ? (
        <p data-mt="chart-empty">{empty}</p>
      ) : table ? (
        <ChartTable dto={dto} spec={spec} />
      ) : (
        <UPlotChart
          dto={dto}
          spec={spec}
          tokens={tokens}
          label={chartSummary(dto, spec, rangeLabel)}
        />
      )}
    </section>
  );
}
