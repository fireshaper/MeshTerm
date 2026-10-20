import type { TopologyDTO } from "@meshterm/shared";

/** Rings by the hop count of each node's last packet. They place nodes; they aren't routes. */
export type Ring = "direct" | "one" | "many" | "unknown";

export const RING_RADIUS: Record<Ring, number> = {
  direct: 38,
  one: 64,
  many: 88,
  unknown: 88,
};

export const RING_LABELS: Record<Exclude<Ring, "unknown">, string> = {
  direct: "Heard directly",
  one: "1 hop",
  many: "2+ hops",
};

export function ringOf(hopsAway: number | null): Ring {
  if (hopsAway === null) return "unknown";
  if (hopsAway === 0) return "direct";
  return hopsAway === 1 ? "one" : "many";
}

/** Shown at most; the rest are counted in `hidden` (least recently heard first to go). */
export const TOPOLOGY_MAX_NODES = 60;

export interface PlacedNode {
  num: number;
  ring: Ring;
  x: number;
  y: number;
}

export interface PlacedLink {
  kind: "direct" | "reported";
  from: number;
  to: number;
  snr: number | null;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TopologyLayout {
  /** My node at the center (0, 0); null when unknown. */
  center: number | null;
  nodes: PlacedNode[];
  links: PlacedLink[];
  hidden: number;
}

/**
 * Places my node at the center and every other node on its ring, evenly spaced and
 * ordered by node number (stable between refreshes). Only the DTO's links are drawn:
 * nothing is added from hop counts.
 */
export function layoutTopology(dto: TopologyDTO): TopologyLayout {
  const shown = [...dto.nodes]
    .sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0) || a.num - b.num)
    .slice(0, TOPOLOGY_MAX_NODES);
  const byRing = new Map<Ring, number[]>();
  for (const n of shown) {
    const ring = ringOf(n.hopsAway);
    byRing.set(ring, [...(byRing.get(ring) ?? []), n.num]);
  }
  const position = new Map<number, { x: number; y: number }>();
  if (dto.myNodeNum !== null) position.set(dto.myNodeNum, { x: 0, y: 0 });
  const nodes: PlacedNode[] = [];
  const order: Ring[] = ["direct", "one", "many", "unknown"];
  order.forEach((ring, ringIndex) => {
    const nums = (byRing.get(ring) ?? []).sort((a, b) => a - b);
    // Unknown-hop nodes share the outer ring, offset half a step from the 2+ ring.
    const offset = ring === "unknown" ? 0.5 : ringIndex * 0.37;
    nums.forEach((num, i) => {
      const angle = ((i + offset) / nums.length) * 2 * Math.PI - Math.PI / 2;
      const r = RING_RADIUS[ring];
      const p = { x: round(Math.cos(angle) * r), y: round(Math.sin(angle) * r) };
      position.set(num, p);
      nodes.push({ num, ring, ...p });
    });
  });
  const links: PlacedLink[] = [];
  for (const l of dto.links) {
    const a = position.get(l.from);
    const b = position.get(l.to);
    if (!a || !b) continue;
    links.push({ ...l, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return {
    center: dto.myNodeNum,
    nodes,
    links,
    hidden: dto.nodes.length - shown.length,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
