import { DEFAULT_DASHBOARD_THRESHOLDS, type NodeCard } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import { scenarioDashboard } from "../test/scenario.js";
import {
  arrangeCards,
  batteryState,
  levelOf,
  matchesSearch,
  nodeStatus,
  type Filter,
  type Sort,
  type ViewOptions,
} from "./view.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const cards = scenarioDashboard("dashboard", NOW).nodes;
const byShort = (short: string) => cards.find((c) => c.shortName === short) as NodeCard;
const options = (o: Partial<ViewOptions> = {}): ViewOptions => ({
  query: "",
  filter: "all",
  sort: "lastSeen",
  now: NOW,
  thresholds: DEFAULT_DASHBOARD_THRESHOLDS,
  ...o,
});
const order = (o: Partial<ViewOptions>) => {
  const s = arrangeCards(cards, options(o));
  return {
    self: s.self?.shortName ?? null,
    favorites: s.favorites.map((c) => c.shortName),
    others: s.others.map((c) => c.shortName),
  };
};

describe("nodeStatus", () => {
  it("uses the thresholds as exclusive upper bounds", () => {
    const t = DEFAULT_DASHBOARD_THRESHOLDS;
    expect(nodeStatus(NOW, NOW, t)).toBe("online");
    expect(nodeStatus(NOW - 15 * MIN + 1, NOW, t)).toBe("online");
    expect(nodeStatus(NOW - 15 * MIN, NOW, t)).toBe("recent");
    expect(nodeStatus(NOW - 120 * MIN, NOW, t)).toBe("stale");
    expect(nodeStatus(NOW - 1440 * MIN + 1, NOW, t)).toBe("stale");
    expect(nodeStatus(NOW - 1440 * MIN, NOW, t)).toBe("offline");
    expect(nodeStatus(null, NOW, t)).toBe("offline");
  });
});

describe("levels", () => {
  it("warn and danger are 'above' the level", () => {
    expect(levelOf(25, 25, 50)).toBe("ok");
    expect(levelOf(25.1, 25, 50)).toBe("warn");
    expect(levelOf(50, 25, 50)).toBe("warn");
    expect(levelOf(50.1, 25, 50)).toBe("danger");
    expect(levelOf(null, 25, 50)).toBe("unknown");
  });

  it("battery: >100 powered, <10 critical, <20 low", () => {
    expect([101, 100, 20, 19, 10, 9, 0, null].map(batteryState)).toEqual([
      "powered",
      "ok",
      "ok",
      "low",
      "low",
      "critical",
      "critical",
      "unknown",
    ]);
  });
});

describe("search", () => {
  it.each([
    ["ridge", "RDG"],
    ["RDG", "RDG"],
    ["!0badcafe", "RDG"],
    ["0badca", "RDG"],
    ["station_g2", "GAR"],
    ["station g2", "GAR"], // the hardware label
  ])("%s finds %s", (query, short) => {
    expect(matchesSearch(byShort(short), query)).toBe(true);
    expect(cards.filter((c) => matchesSearch(c, query)).map((c) => c.shortName)).toEqual([short]);
  });

  it("an empty query matches everything", () => {
    expect(cards.every((c) => matchesSearch(c, "  "))).toBe(true);
  });
});

describe("arrangeCards", () => {
  it("puts my node first and pins favorites above the rest", () => {
    expect(order({})).toEqual({
      self: "MTB",
      favorites: ["RDG", "HIL"],
      others: ["GAR", "TRL", "KYK", "BIK"],
    });
  });

  it.each<[Filter, ReturnType<typeof order>]>([
    ["online", { self: "MTB", favorites: ["RDG"], others: ["GAR"] }],
    ["favorites", { self: null, favorites: ["RDG", "HIL"], others: [] }],
    ["position", { self: "MTB", favorites: ["RDG", "HIL"], others: ["GAR", "TRL"] }],
  ])("filter %s", (filter, expected) => {
    expect(order({ filter })).toEqual(expected);
  });

  it.each<[Sort, string[]]>([
    ["name", ["BIK", "GAR", "KYK", "TRL"]],
    // From my node (Seattle downtown): Garage ~1.6 km, Trail ~16 km; no position last.
    ["distance", ["GAR", "TRL", "KYK", "BIK"]],
    ["battery", ["KYK", "TRL", "GAR", "BIK"]],
    ["hops", ["TRL", "GAR", "KYK", "BIK"]],
    ["snr", ["GAR", "TRL", "KYK", "BIK"]],
  ])("sort %s", (sort, others) => {
    expect(order({ sort }).others).toEqual(others);
    expect(order({ sort }).self).toBe("MTB");
  });

  it("search applies to every section", () => {
    expect(order({ query: "hill" })).toEqual({ self: null, favorites: ["HIL"], others: [] });
  });
});
