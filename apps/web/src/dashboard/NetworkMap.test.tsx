import type { TopologyDTO, TrafficDTO } from "@meshterm/shared";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
import { expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioDashboard } from "../test/scenario.js";
import { layoutTopology, RING_RADIUS, ringOf, TOPOLOGY_MAX_NODES } from "./topology.js";

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
  it("rings by hop count, my node in the center", () => {
    const layout = layoutTopology(topology());
    expect(layout.center).toBe(ME);
    const ring = (num: number) => layout.nodes.find((n) => n.num === num);
    for (const [num, r] of [
      [RIDGE, RING_RADIUS.direct],
      [HILL, RING_RADIUS.direct],
      [TRAIL, RING_RADIUS.one],
      [GARAGE, RING_RADIUS.many],
    ] as const) {
      const n = ring(num);
      expect(Math.hypot(n?.x ?? 0, n?.y ?? 0)).toBeCloseTo(r, 0);
    }
    expect([null, 0, 1, 2, 7].map(ringOf)).toEqual(["unknown", "direct", "one", "many", "many"]);
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
    const garage = svg.getByRole("button", {
      name: /Garage Station · 2 hops away \(route unknown\)/,
    });
    fireEvent.keyDown(garage, { key: "Enter" });
    expect(useUiStore.getState().selectedNode).toBe(GARAGE);
  });

  it("says so when no other node was heard in the window", async () => {
    await render(topology({ nodes: [], links: [] }));
    expect(screen.getByText("No other nodes heard in the last 1d")).toBeInTheDocument();
  });
});
