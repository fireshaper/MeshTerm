import { describe, expect, it } from "vitest";
import { inQuietHours, NotificationPrefsPatch } from "./notifications.js";

const at = (hh: number, mm = 0) => Date.UTC(2026, 9, 21, hh, mm);

describe("inQuietHours", () => {
  it("handles windows across midnight and in a day", () => {
    const night = { start: "22:00", end: "07:00" };
    expect(inQuietHours(night, at(23), 0)).toBe(true);
    expect(inQuietHours(night, at(6, 59), 0)).toBe(true);
    expect(inQuietHours(night, at(7), 0)).toBe(false);
    expect(inQuietHours({ start: "12:00", end: "13:00" }, at(12, 30), 0)).toBe(true);
    expect(inQuietHours(null, at(23), 0)).toBe(false);
  });

  it("uses the server's offset", () => {
    // 21:30 UTC is 23:30 at UTC+2.
    expect(inQuietHours({ start: "22:00", end: "07:00" }, at(21, 30), 120)).toBe(true);
    expect(inQuietHours({ start: "22:00", end: "07:00" }, at(21, 30), 0)).toBe(false);
  });

  it("validates patches", () => {
    expect(NotificationPrefsPatch.safeParse({}).success).toBe(false);
    expect(
      NotificationPrefsPatch.safeParse({ quietHours: { start: "25:00", end: "07:00" } }).success,
    ).toBe(false);
    expect(NotificationPrefsPatch.safeParse({ dndUntil: null }).success).toBe(true);
  });
});
