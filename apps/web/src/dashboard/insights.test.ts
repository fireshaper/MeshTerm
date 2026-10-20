import { DEFAULT_DASHBOARD_THRESHOLDS, type NodeCard } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import { scenarioDashboard } from "../test/scenario.js";
import { attentionItems, isStale, recentlyActive, signalQuality } from "./insights.js";
import { matchesPower, powerClass } from "./view.js";

const NOW = 1_800_000_000_000;
const T = DEFAULT_DASHBOARD_THRESHOLDS;
const cards = () => scenarioDashboard("dashboard", NOW).nodes;
const byShort = (list: NodeCard[], short: string) =>
  list.find((c) => c.shortName === short) as NodeCard;

describe("signalQuality", () => {
  it("bands the SNR of the last direct packet", () => {
    expect([10, 5, 4.9, 0, -0.5, -7, -7.5, null].map(signalQuality)).toEqual([
      "good",
      "good",
      "fair",
      "fair",
      "weak",
      "weak",
      "poor",
      "unknown",
    ]);
  });
});

describe("power", () => {
  it("classes nodes by reported power and filters on it", () => {
    const list = cards();
    expect(list.map((c) => [c.shortName, powerClass(c)])).toEqual([
      ["MTB", "battery"],
      ["RDG", "external"],
      ["TRL", "battery"],
      ["GAR", "battery"],
      ["HIL", "low"],
      ["KYK", "low"],
      ["BIK", "unknown"],
    ]);
    // "On battery" includes low batteries.
    expect(list.filter((c) => matchesPower(c, "battery")).map((c) => c.shortName)).toEqual([
      "MTB",
      "TRL",
      "GAR",
      "HIL",
      "KYK",
    ]);
    expect(list.filter((c) => matchesPower(c, "any"))).toHaveLength(7);
  });
});

describe("attentionItems", () => {
  it("flags low batteries on nodes still around and quiet favorites, not long-silent ones", () => {
    const items = attentionItems(cards(), NOW, T);
    expect(items.map((i) => [i.card.shortName, i.kind, i.severity, i.text])).toEqual([
      ["HIL", "battery", "warn", "Battery 15%"],
      ["HIL", "quiet-favorite", "warn", "Not heard for 7h"],
    ]);
  });

  it("puts critical batteries and my node's busy channel first", () => {
    const list = cards();
    const self = byShort(list, "MTB");
    if (self.device) {
      self.device.channelUtil = 55; // danger above 50
      self.device.airUtilTx = 8; // warn above 7
      self.device.batteryLevel = 9; // critical
    }
    const items = attentionItems(list, NOW, T);
    expect(items.map((i) => [i.card.shortName, i.kind, i.severity])).toEqual([
      ["MTB", "battery", "danger"],
      ["MTB", "channel-util", "danger"],
      ["MTB", "air-util-tx", "warn"],
      ["HIL", "battery", "warn"],
      ["HIL", "quiet-favorite", "warn"],
    ]);
  });
});

describe("recentlyActive", () => {
  it("lists other nodes heard within the recent window, newest first", () => {
    expect(recentlyActive(cards(), NOW, T).map((c) => c.shortName)).toEqual(["GAR", "TRL"]);
  });
});

describe("isStale", () => {
  it("is true from the recent threshold on", () => {
    expect(isStale(NOW - 119 * 60_000, NOW, T)).toBe(false);
    expect(isStale(NOW - 120 * 60_000, NOW, T)).toBe(true);
  });
});
