import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, PREFS_KEY, readPrefs, useDashboardPrefs } from "./prefs.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dashboard prefs", () => {
  it("persist across remounts", () => {
    const first = renderHook(() => useDashboardPrefs());
    act(() => {
      first.result.current[1]({ filter: "online", sort: "battery" });
    });
    act(() => {
      first.result.current[1]({ density: "compact" });
    });
    first.unmount();
    const second = renderHook(() => useDashboardPrefs());
    expect(second.result.current[0]).toEqual({
      filter: "online",
      sort: "battery",
      density: "compact",
    });
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
    const { result } = renderHook(() => useDashboardPrefs());
    expect(result.current[0]).toEqual(DEFAULT_PREFS);
    act(() => {
      result.current[1]({ filter: "favorites" });
    });
    expect(result.current[0].filter).toBe("favorites");
  });
});
