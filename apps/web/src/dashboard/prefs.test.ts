import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, PREFS_KEY, readPrefs, useNodePrefs } from "./prefs.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("node page prefs", () => {
  it("persist across remounts", () => {
    const first = renderHook(() => useNodePrefs());
    act(() => {
      first.result.current[1]({ filter: "heard", sort: "battery" });
    });
    act(() => {
      first.result.current[1]({
        density: "compact",
        view: "table",
        role: "ROUTER",
        power: "low",
        columns: ["id"],
      });
    });
    first.unmount();
    const second = renderHook(() => useNodePrefs());
    expect(second.result.current[0]).toEqual({
      filter: "heard",
      sort: "battery",
      density: "compact",
      view: "table",
      role: "ROUTER",
      power: "low",
      hasPosition: false,
      columns: ["id"],
    });
  });

  it("carry over the filters from before the chips (CR-005)", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: "online" }));
    expect(readPrefs()).toMatchObject({ filter: "heard", hasPosition: false });
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: "position" }));
    expect(readPrefs()).toMatchObject({ filter: "all", hasPosition: true });
  });

  it("fall back to defaults for missing or invalid values", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: "nope", sort: "name" }));
    expect(readPrefs()).toEqual({ ...DEFAULT_PREFS, sort: "name" });
    localStorage.setItem(PREFS_KEY, "{not json");
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("keep working when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { result } = renderHook(() => useNodePrefs());
    expect(result.current[0]).toEqual(DEFAULT_PREFS);
    act(() => {
      result.current[1]({ filter: "favorites" });
    });
    expect(result.current[0].filter).toBe("favorites");
  });
});
