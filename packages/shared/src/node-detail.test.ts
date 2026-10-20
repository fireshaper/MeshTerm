import { describe, expect, it } from "vitest";
import { bucketFor, keyFingerprint, rateBucketFor, SERIES_MAX_POINTS } from "./node-detail.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("bucketFor", () => {
  it.each([
    [HOUR, 0],
    [2 * HOUR, 0],
    [24 * HOUR, 5 * MIN],
    [36 * HOUR, 5 * MIN],
    [7 * DAY, 30 * MIN],
    [8 * DAY, 30 * MIN],
    [30 * DAY, 2 * HOUR],
  ])("%d ms → %d ms", (span, bucket) => {
    expect(bucketFor(span)).toBe(bucket);
  });

  it("widens so a series never exceeds the point cap", () => {
    const span = 366 * DAY;
    expect(span / bucketFor(span)).toBeLessThanOrEqual(SERIES_MAX_POINTS);
  });

  it("packet-rate bars: 5 min, hourly, 6 h", () => {
    expect(rateBucketFor(HOUR)).toBe(5 * MIN);
    expect(rateBucketFor(DAY)).toBe(HOUR);
    expect(rateBucketFor(30 * DAY)).toBe(6 * HOUR);
  });
});

describe("keyFingerprint", () => {
  it("is the first 8 bytes of a 32-byte key", () => {
    expect(keyFingerprint("ab".repeat(32))).toBe("ab".repeat(8));
    expect(keyFingerprint("abc")).toBeNull();
    expect(keyFingerprint(null)).toBeNull();
  });
});
