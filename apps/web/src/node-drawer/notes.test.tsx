import { DEFAULT_DASHBOARD_THRESHOLDS, type NodeDetailDTO } from "@meshterm/shared";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { batteryForecast } from "../dashboard/insights.js";
import { scenarioNodeDetail } from "../test/scenario.js";
import { detailNotes, SILENT_ROUTER_MS } from "./notes.js";
import { highlightJson } from "./RawTab.js";

const NOW = 1_800_000_000_000;
const H = 3600_000;
/** One reading an hour, ending now. */
const hourly = (levels: number[]): [number, number][] =>
  levels.map((v, i) => [NOW - (levels.length - 1 - i) * H, v]);

describe("batteryForecast", () => {
  it("fits a falling battery and says when it reaches 10 %", () => {
    const f = batteryForecast(hourly([48, 46, 44, 42, 40]));
    expect(f?.perHour).toBeCloseTo(-2, 5);
    expect(f?.hours).toBeCloseTo(15, 5);
  });

  it("only for a falling battery under 50 % with a good fit over two hours", () => {
    expect(batteryForecast(hourly([60, 58, 56, 54, 52]))).toBeNull(); // still above 50 %
    expect(batteryForecast(hourly([40, 41, 42, 43, 44]))).toBeNull(); // charging
    expect(batteryForecast(hourly([40, 20, 45, 15, 38]))).toBeNull(); // noise
    expect(batteryForecast(hourly([30, 29, 28]))).toBeNull(); // too few
    const quick: [number, number][] = [0, 1, 2, 3, 4].map((i) => [NOW - (4 - i) * 60_000, 40 - i]);
    expect(batteryForecast(quick)).toBeNull(); // four minutes
    expect(batteryForecast(hourly([30, 30, 30, 30]))).toBeNull(); // flat
  });

  it("ignores external-power readings", () => {
    expect(batteryForecast(hourly([101, 48, 46, 44, 42, 101]))?.perHour).toBeCloseTo(-2, 5);
  });
});

describe("detailNotes", () => {
  const base = (over: Partial<NodeDetailDTO>): NodeDetailDTO => ({
    ...scenarioNodeDetail(195939070, "dashboard", NOW),
    ...over,
  });

  it("a battery forecast when the battery drains", () => {
    const notes = detailNotes(
      base({ batterySpark: hourly([48, 46, 44, 42, 40]) }),
      NOW,
      DEFAULT_DASHBOARD_THRESHOLDS,
    );
    expect(notes.map((n) => n.kind)).toEqual(["battery-forecast"]);
    expect(notes[0]?.text).toBe(
      "The battery is falling about 2 % an hour; at this rate it reaches 10 % in about 15h.",
    );
  });

  it("a silent router, but not a silent client or my node", () => {
    const quiet = NOW - SILENT_ROUTER_MS - 60_000;
    const router = base({ role: "ROUTER", lastHeard: quiet, batterySpark: [] });
    expect(detailNotes(router, NOW, DEFAULT_DASHBOARD_THRESHOLDS).map((n) => n.kind)).toEqual([
      "silent-router",
    ]);
    expect(detailNotes({ ...router, role: "CLIENT" }, NOW, DEFAULT_DASHBOARD_THRESHOLDS)).toEqual(
      [],
    );
    expect(detailNotes({ ...router, isSelf: true }, NOW, DEFAULT_DASHBOARD_THRESHOLDS)).toEqual([]);
    expect(
      detailNotes({ ...router, lastHeard: NOW - 60_000 }, NOW, DEFAULT_DASHBOARD_THRESHOLDS),
    ).toEqual([]);
  });
});

describe("highlightJson", () => {
  it("wraps keys and typed values without changing the text", () => {
    const json = JSON.stringify(
      { name: 'Ridge "R" 1', num: -12.5e3, ok: true, none: null, list: [1, "a"] },
      null,
      2,
    );
    const { container } = render(<pre>{highlightJson(json)}</pre>);
    expect(container.textContent).toBe(json);
    const keys = [...container.querySelectorAll('[data-mt="raw-key"]')].map((e) => e.textContent);
    expect(keys).toEqual(['"name"', '"num"', '"ok"', '"none"', '"list"']);
    const values = [...container.querySelectorAll('[data-mt="raw-value"]')].map((e) => [
      e.getAttribute("data-mt-variant"),
      e.textContent,
    ]);
    expect(values).toEqual([
      ["string", '"Ridge \\"R\\" 1"'],
      ["number", "-12500"],
      ["boolean", "true"],
      ["null", "null"],
      ["number", "1"],
      ["string", '"a"'],
    ]);
  });
});
