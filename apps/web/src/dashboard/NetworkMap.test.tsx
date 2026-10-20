import type { TopologyDTO, TrafficDTO } from "@meshterm/shared";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
import { expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioDashboard } from "../test/scenario.js";
import {
  bandPlacements,
  DISK_INNER,
  DISK_OUTER,
  DISK_RADIUS,
  layoutTopology,
  MIN_BAND_SHARE,
  ringOf,
  TOPOLOGY_MAX_NODES,
} from "./topology.js";

const NOW = Date.now();
const ME = 2712847316;
const RIDGE = 195939070;
const TRAIL = 439041101;
const GARAGE = 1584361601;
const HILL = 573785173;

const topology = (overrides: Partial<TopologyDTO> = {}): TopologyDTO => ({
  myNodeNum: ME,
  windowMs: 86_400_000,
  nodes: [
    { num: RIDGE, hopsAway: 0, lastHeard: NOW - 120_000 },
    { num: HILL, hopsAway: 0, lastHeard: NOW - 7 * 3600_000 },
    { num: TRAIL, hopsAway: 1, lastHeard: NOW - 1800_000 },
    { num: GARAGE, hopsAway: 2, lastHeard: NOW - 600_000 },
  ],
  links: [
    { kind: "direct", from: ME, to: RIDGE, snr: 7.25, time: NOW - 120_000 },
    { kind: "direct", from: ME, to: HILL, snr: 9.5, time: NOW - 7 * 3600_000 },
    { kind: "reported", from: RIDGE, to: TRAIL, snr: -2.25, time: NOW - 60_000 },
  ],
  ...overrides,
});

const traffic: TrafficDTO = {
  window: "24h",
  bucketMs: 3_600_000,
  from: 0,
  to: 1,
  buckets: [],
  ports: [],
  topNodes: [],
};

describe("layoutTopology", () => {
  it("places each node inside its hop band, my node in the center", () => {
    const layout = layoutTopology(topology());
    expect(layout.center).toBe(ME);
    const distance = (num: number) => {
      const n = layout.nodes.find((x) => x.num === num);
      return Math.hypot(n?.x ?? 0, n?.y ?? 0);
    };
    const band = (ring: string) => layout.bands.find((b) => b.ring === ring);
    for (const [num, ring] of [
      [RIDGE, "direct"],
      [HILL, "direct"],
      [TRAIL, "one"],
      [GARAGE, "many"],
    ] as const) {
      expect(distance(num)).toBeGreaterThanOrEqual(band(ring)?.inner ?? Infinity);
      expect(distance(num)).toBeLessThanOrEqual(band(ring)?.outer ?? 0);
    }
    // Bands follow each other outward and fill the disk.
    expect(layout.bands.map((b) => b.ring)).toEqual(["direct", "one", "many"]);
    expect(layout.bands[0]?.inner).toBeCloseTo(DISK_INNER * DISK_RADIUS, 1);
    expect(layout.bands[1]?.inner).toBe(layout.bands[0]?.outer);
    expect(layout.bands[2]?.outer).toBeCloseTo(DISK_OUTER * DISK_RADIUS, 1);
    expect([null, 0, 1, 2, 7].map(ringOf)).toEqual(["unknown", "direct", "one", "many", "many"]);
  });

  it("fills a band's area evenly instead of lining nodes up on a circle", () => {
    const nodes = Array.from({ length: 80 }, (_, i) => ({
      num: 5000 + i,
      hopsAway: 3,
      lastHeard: NOW - i * 1000,
    }));
    const layout = layoutTopology(topology({ nodes, links: [] }));
    const radii = layout.nodes.map((n) => Math.hypot(n.x, n.y));
    const many = layout.bands.find((b) => b.ring === "many");
    const inner = many?.inner ?? 0;
    const outer = many?.outer ?? 0;
    expect(Math.min(...radii)).toBeLessThan(inner + 3);
    expect(Math.max(...radii)).toBeGreaterThan(outer - 3);
    // Half the area of the band lies inside this radius; about half the nodes should too.
    const median = Math.sqrt((inner * inner + outer * outer) / 2);
    const insideMedian = radii.filter((r) => r < median).length;
    expect(insideMedian).toBeGreaterThanOrEqual(38);
    expect(insideMedian).toBeLessThanOrEqual(42);
    // Dots shrink for a crowded disk.
    expect(layout.dot).toBeLessThan(4.5);
  });

  it("draws exactly the links it was given, from their endpoints' positions", () => {
    const layout = layoutTopology(topology());
    expect(layout.links.map((l) => [l.kind, l.from, l.to])).toEqual([
      ["direct", ME, RIDGE],
      ["direct", ME, HILL],
      ["reported", RIDGE, TRAIL],
    ]);
    const reported = layout.links[2];
    const ridge = layout.nodes.find((n) => n.num === RIDGE);
    expect([reported?.x1, reported?.y1]).toEqual([ridge?.x, ridge?.y]);
    // Garage (2 hops) gets no line at all: no route is invented.
    expect(layout.links.some((l) => l.to === GARAGE || l.from === GARAGE)).toBe(false);
  });

  it("sizes bands by their share of nodes, with a minimum for small bands", () => {
    const area = (b: { inner: number; outer: number }) => b.outer ** 2 - b.inner ** 2;
    const total = (DISK_OUTER * DISK_RADIUS) ** 2 - (DISK_INNER * DISK_RADIUS) ** 2;
    const even = bandPlacements([10, 30, 60]);
    // 10 % is lifted to the minimum; the extra 8 % comes from the others in proportion (30:60).
    expect(even.map((b) => Number((area(b) / total).toFixed(2)))).toEqual([
      MIN_BAND_SHARE,
      0.27,
      0.55,
    ]);
    // Empty bands still get room; shares add up to the whole disk.
    const lopsided = bandPlacements([0, 0, 50]);
    const shares = lopsided.map((b) => area(b) / total);
    expect(shares[0]).toBeCloseTo(MIN_BAND_SHARE, 2);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  });

  it("doesn't draw a reported link over a direct one for the same pair", () => {
    const layout = layoutTopology(
      topology({
        links: [
          { kind: "direct", from: ME, to: RIDGE, snr: 7.25, time: NOW },
          { kind: "reported", from: RIDGE, to: ME, snr: -9, time: NOW },
          { kind: "reported", from: RIDGE, to: TRAIL, snr: 1, time: NOW },
        ],
      }),
    );
    expect(layout.links.map((l) => [l.kind, l.from, l.to])).toEqual([
      ["direct", ME, RIDGE],
      ["reported", RIDGE, TRAIL],
    ]);
  });

  it("is stable for the same input and caps the node count", () => {
    expect(layoutTopology(topology())).toEqual(layoutTopology(topology()));
    const many = Array.from({ length: TOPOLOGY_MAX_NODES + 7 }, (_, i) => ({
      num: 1000 + i,
      hopsAway: i % 3,
      lastHeard: NOW - i * 1000,
    }));
    const layout = layoutTopology(topology({ nodes: many, links: [] }));
    expect(layout.nodes).toHaveLength(TOPOLOGY_MAX_NODES);
    expect(layout.hidden).toBe(7);
    // The least recently heard are the ones left out.
    expect(layout.nodes.some((n) => n.num === 1000 + TOPOLOGY_MAX_NODES + 6)).toBe(false);
  });
});

describe("<NetworkMap />", () => {
  async function render(dto: TopologyDTO) {
    return renderApp("/dashboard", {
      dashboard: scenarioDashboard("dashboard", NOW),
      queries: [
        [queryKeys.topology(1), dto],
        [queryKeys.traffic(1, "24h"), traffic],
        [queryKeys.activity(1), { events: [], nextBefore: null }],
      ],
    });
  }

  it("shows rings, observed links, and nodes that open their details", async () => {
    await render(topology());
    const map = document.querySelector<HTMLElement>('[data-mt="network-map"]');
    expectDataMt(map, "network-map");
    expect(
      map?.querySelectorAll('[data-mt="network-link"][data-mt-variant="direct"]'),
    ).toHaveLength(2);
    expect(
      map?.querySelectorAll('[data-mt="network-link"][data-mt-variant="reported"]'),
    ).toHaveLength(1);
    const svg = within(map as HTMLElement);
    const ridge = svg.getByRole("button", {
      name: "Ridge Repeater · heard directly · SNR 7.25 dB · heard 2 min ago",
    });
    expectDataMt(ridge, "network-node", { state: "online" });
    expect(ridge.getAttribute("data-mt-variant")).toContain("router");
    // Directly heard nodes carry their name on the disk; others only on hover.
    expect(ridge.getAttribute("data-mt-variant")).toContain("labeled");
    expect(ridge.querySelector("text")).toHaveTextContent("RDG");
    const garage = svg.getByRole("button", {
      name: /Garage Station · 2 hops away \(route unknown\)/,
    });
    expect(garage.querySelector("text")).toBeNull();
    fireEvent.mouseEnter(garage);
    expect(map?.querySelector('[data-mt="network-hover-label"]')).toHaveTextContent("GAR");
    fireEvent.keyDown(garage, { key: "Enter" });
    expect(useUiStore.getState().selectedNode).toBe(GARAGE);
  });

  it("says so when no other node was heard in the window", async () => {
    await render(topology({ nodes: [], links: [] }));
    expect(screen.getByText("No other nodes heard in the last 1d")).toBeInTheDocument();
  });
});
