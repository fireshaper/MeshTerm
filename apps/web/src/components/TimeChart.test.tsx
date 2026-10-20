import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { niceCeil, TimeChart, type ChartSeries } from "./TimeChart.js";

const HOUR = 3600_000;
const FROM = 1_800_000_000_000;
const times = [0, 1, 2, 3].map((i) => FROM + i * HOUR);

const series = (overrides: Partial<Record<string, (number | null)[]>> = {}): ChartSeries[] => [
  {
    id: "in",
    label: "Received",
    kind: "bar",
    axis: "left",
    color: "--mt-chart-1",
    values: overrides.in ?? [1, 0, 3, 2],
    format: (v) => `${v} in`,
  },
  {
    id: "out",
    label: "Sent",
    kind: "bar",
    axis: "left",
    color: "--mt-chart-2",
    values: overrides.out ?? [1, 0, 0, 0],
    format: (v) => `${v} out`,
  },
  {
    id: "util",
    label: "Util",
    kind: "line",
    axis: "right",
    color: "--mt-status-warn",
    values: overrides.util ?? [10, null, 12, 14],
    format: (v) => `${v}%`,
  },
];

function renderChart(s: ChartSeries[] = series()) {
  return render(
    <TimeChart
      label="Traffic"
      summary="6 received"
      times={times}
      from={FROM}
      to={FROM + 4 * HOUR}
      bucketMs={HOUR}
      series={s}
      formatTime={(t) => `t+${(t - FROM) / HOUR}h`}
      emptyText="Nothing recorded"
    />,
  );
}

describe("niceCeil", () => {
  it("rounds up to 1, 2 or 5 × 10ⁿ", () => {
    expect([0, 0.4, 1, 1.1, 2, 3, 7, 12, 49, 51, 999].map(niceCeil)).toEqual([
      1, 1, 1, 2, 2, 5, 10, 20, 50, 100, 1000,
    ]);
  });
});

describe("<TimeChart />", () => {
  it("draws stacked bars, skips zero bars, and splits lines at gaps", () => {
    const { container } = renderChart();
    expectDataMt(byDataMt("chart"), "chart", { state: "ready" });
    // 3 non-zero "in" values + 1 non-zero "out" value.
    expect(container.querySelectorAll('[data-mt="chart-bar"]')).toHaveLength(4);
    // The null splits util into a lone point (a dot) and a two-point line.
    expect(container.querySelectorAll('[data-mt="chart-dot"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-mt="chart-line"]')).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Traffic. 6 received" })).toBeInTheDocument();
    expect(
      [...container.querySelectorAll('[data-mt="chart-legend-item"]')].map((e) => e.textContent),
    ).toEqual(["Received", "Sent", "Util"]);
  });

  it("stacks the second bar series on top of the first", () => {
    const { container } = renderChart();
    const [inBar, outBar] = [
      ...container.querySelectorAll<SVGRectElement>('[data-mt="chart-bar"]'),
    ];
    // Bucket 0: in = 1 (bottom), out = 1 (above it); left axis max niceCeil(3) = 5.
    expect(Number(inBar?.getAttribute("y")) + Number(inBar?.getAttribute("height"))).toBeCloseTo(
      200,
    );
    expect(Number(outBar?.getAttribute("y")) + Number(outBar?.getAttribute("height"))).toBeCloseTo(
      Number(inBar?.getAttribute("y")),
    );
  });

  it("keyboard: arrows move a tooltip that says No data for gaps", () => {
    renderChart();
    const plot = screen.getByRole("img", { name: /Traffic/ });
    fireEvent.keyDown(plot, { key: "ArrowLeft" }); // from the last bucket to the third
    expect(screen.getByRole("tooltip")).toHaveTextContent("t+2hReceived: 3 inSent: 0 outUtil: 12%");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Util: No data");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the empty text instead of an all-zero chart", () => {
    renderChart(series({ in: [0, 0, 0, 0], out: [0, 0, 0, 0], util: [null, null, null, null] }));
    expectDataMt(byDataMt("chart"), "chart", { state: "empty" });
    expect(screen.getByText("Nothing recorded")).toBeInTheDocument();
  });
});
