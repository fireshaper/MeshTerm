import { DEFAULT_DASHBOARD_THRESHOLDS, type NodeCard } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import {
  gaugeArc,
  heroFrame,
  heroHeadline,
  heroNodes,
  rosterCards,
  visibleLabels,
} from "./overview.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const T = DEFAULT_DASHBOARD_THRESHOLDS;

function card(num: number, patch: Partial<NodeCard> = {}): NodeCard {
  return {
    num,
    userId: `!${num.toString(16).padStart(8, "0")}`,
    longName: `Node ${num}`,
    shortName: `N${num}`,
    role: "CLIENT",
    hwModel: null,
    isFavorite: false,
    isSelf: false,
    lastHeard: NOW - 5 * MIN,
    hopsAway: 0,
    snr: 5,
    rssi: -90,
    position: null,
    device: null,
    environment: null,
    batterySpark: [],
    ...patch,
  };
}
const at = (lat: number, lon: number) => ({ lat, lon, alt: null, precisionBits: null, time: NOW });

describe("heroNodes", () => {
  it("my node and others with a position heard in the recent window", () => {
    const cards = [
      card(1, { isSelf: true, position: at(45, -122), lastHeard: NOW - 999 * MIN }),
      card(2, { position: at(45.01, -122) }),
      card(3, { position: at(45.02, -122), lastHeard: NOW - 3 * 60 * MIN }),
      card(4),
    ];
    expect(heroNodes(cards, NOW, T).map((c) => c.num)).toEqual([1, 2]);
  });
});

describe("heroHeadline", () => {
  const self = card(1, { isSelf: true, position: at(45, -122) });

  it("counts nodes heard in the window, direct ones, nearest and farthest", () => {
    const h = heroHeadline(
      [
        self,
        card(2, { longName: "Garage", position: at(45.006, -122) }),
        card(3, { longName: "Ridge", hopsAway: 1, position: at(45.09, -122) }),
        card(4, { lastHeard: NOW - 5 * 60 * MIN }),
      ],
      NOW,
      T,
    );
    expect(h.title).toBe("2 of 3 nodes on the air");
    expect(h.detail).toBe(
      "1 heard direct · nearest Garage 667 m · farthest Ridge, 10 km N · last 2 h",
    );
  });

  it("reads right for one node, nobody heard, and an empty mesh", () => {
    expect(heroHeadline([self, card(2)], NOW, T).title).toBe("1 of 1 node on the air");
    expect(heroHeadline([self, card(2, { lastHeard: null })], NOW, T)).toEqual({
      title: "No nodes heard in the last 2 h",
      detail: "1 known node; none has been heard recently.",
    });
    expect(heroHeadline([self], NOW, T).title).toBe("Only your node so far");
  });

  it("leaves out distances when my node has no position", () => {
    expect(heroHeadline([card(1, { isSelf: true }), card(2)], NOW, T).detail).toBe(
      "1 heard direct · last 2 h",
    );
  });
});

describe("rosterCards", () => {
  it("my node, favorites, then most recently heard, capped", () => {
    const cards = [
      card(5, { lastHeard: NOW - 1 * MIN }),
      card(4, { isFavorite: true, lastHeard: NOW - 50 * MIN }),
      card(1, { isSelf: true }),
      card(3, { lastHeard: NOW - 20 * MIN }),
      card(2, { lastHeard: null }),
    ];
    expect(rosterCards(cards, 4).map((c) => c.num)).toEqual([1, 4, 5, 3]);
  });
});

describe("heroFrame", () => {
  it("fits every point inside the padding and covers the box with tiles", () => {
    const points = [at(45, -122), at(45.1, -121.9), at(44.95, -122.1)];
    const f = heroFrame(points, 800, 540);
    if (!f) throw new Error("no frame");
    for (const p of points) {
      const { x, y } = f.project(p);
      expect(x).toBeGreaterThanOrEqual(48);
      expect(x).toBeLessThanOrEqual(800 - 48);
      expect(y).toBeGreaterThanOrEqual(48);
      expect(y).toBeLessThanOrEqual(540 - 48);
    }
    const covers = (x: number, y: number) =>
      f.tiles.some((t) => x >= t.px && x < t.px + 256 && y >= t.py && y < t.py + 256);
    expect(covers(0, 0) && covers(799, 539)).toBe(true);
    expect(f.pxPerMeter).toBeGreaterThan(0);
  });

  it("zoom 13 for a single point; nothing for no points or no size", () => {
    expect(heroFrame([at(45, -122)], 400, 300)?.z).toBe(13);
    expect(heroFrame([], 400, 300)).toBeNull();
    expect(heroFrame([at(45, -122)], 0, 300)).toBeNull();
  });
});

describe("visibleLabels", () => {
  it("keeps labels in priority order unless they overlap one already kept", () => {
    const kept = visibleLabels([
      { num: 1, x: 100, y: 100, chars: 3 },
      { num: 2, x: 105, y: 105, chars: 3 },
      { num: 3, x: 300, y: 100, chars: 3 },
    ]);
    expect([...kept]).toEqual([1, 3]);
  });
});

describe("gaugeArc", () => {
  it("starts at the same point and grows clockwise; a long arc past half way", () => {
    expect(gaugeArc(0.2).split("A")[0]).toBe(gaugeArc(0.9).split("A")[0]);
    expect(gaugeArc(0.2)).toContain(" 0 0 1 ");
    expect(gaugeArc(0.9)).toContain(" 0 1 1 ");
    expect(gaugeArc(2)).toBe(gaugeArc(1));
  });
});
