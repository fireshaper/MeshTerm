import { describe, expect, it } from "vitest";
import { parseDash } from "./chart-tokens.js";

describe("parseDash (CR-004: --mt-chart-N-dash)", () => {
  it.each([
    ["6 3", [6, 3]],
    ["  4, 2 1 ", [4, 2, 1]],
    ["none", null],
    ["", null],
    ["6 -3", null],
    ["dotted", null],
  ])("%j → %j", (value, dash) => {
    expect(parseDash(value)).toEqual(dash);
  });
});
