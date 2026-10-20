import type { TopologyDTO } from "@meshterm/shared";

/** Bands by the hop count of each node's last packet. They place nodes; they aren't routes. */
export type Ring = "direct" | "one" | "many" | "unknown";

/** Disk radius in view units (the view box is -104…104). */
export const DISK_RADIUS = 96;

/** The disk between these radii holds the bands (fractions of the disk radius). */
export const DISK_INNER = 0.14;
export const DISK_OUTER = 0.96;
/** No band gets less than this share of the disk's area, even when (nearly) empty. */
export const MIN_BAND_SHARE = 0.18;

/**
 * Default band edges (fractions of the disk radius), used when there are no nodes.
 * With nodes, `layoutTopology` sizes the bands by how many nodes each holds.
 */
export const BANDS: Record<Ring, [number, number]> = {
  direct: [0.14, 0.42],
  one: [0.42, 0.68],
  many: [0.68, 0.96],
  // Unknown hop counts share the outer band.
  unknown: [0.68, 0.96],
};

/** Back-compat: the outer edge of each band. */
export const RING_RADIUS: Record<Ring, number> = {
  direct: BANDS.direct[1] * DISK_RADIUS,
  one: BANDS.one[1] * DISK_RADIUS,
  many: BANDS.many[1] * DISK_RADIUS,
  unknown: BANDS.unknown[1] * DISK_RADIUS,
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
export const TOPOLOGY_MAX_NODES = 120;

/** Dot radius: smaller as the mesh grows, so a full disk doesn't turn into a blob. */
export function dotRadius(count: number): number {
  return Math.max(2.2, Math.min(4.5, 4.5 * Math.sqrt(30 / Math.max(1, count))));
}

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

/** Where each band sits in this layout (view units). */
export interface BandPlacement {
  ring: Exclude<Ring, "unknown">;
  inner: number;
  outer: number;
  count: number;
}

export interface TopologyLayout {
  /** My node at the center (0, 0); null when unknown. */
  center: number | null;
  bands: BandPlacement[];
  nodes: PlacedNode[];
  links: PlacedLink[];
  hidden: number;
  /** Dot radius for this many nodes. */
  dot: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * My node at the center; every other node inside its hop band, spread evenly over
 * the band's area with a golden-angle (sunflower) spiral, ordered by node number so
 * positions are stable between refreshes. Only the DTO's links are drawn: nothing
 * is added from hop counts.
 */
export function layoutTopology(dto: TopologyDTO): TopologyLayout {
  const shown = [...dto.nodes]
    .sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0) || a.num - b.num)
    .slice(0, TOPOLOGY_MAX_NODES);
  // Unknown hop counts join the outer band, after the 2+ hop nodes.
  const bands: { ring: Ring; nums: number[] }[] = [
    { ring: "direct", nums: [] },
    { ring: "one", nums: [] },
    { ring: "many", nums: [] },
  ];
  const ringOfNum = new Map<number, Ring>();
  for (const n of shown) {
    const ring = ringOf(n.hopsAway);
    ringOfNum.set(n.num, ring);
    const band = ring === "unknown" ? "many" : ring;
    bands.find((b) => b.ring === band)?.nums.push(n.num);
  }

  const placements = bandPlacements(bands.map((b) => b.nums.length));

  const position = new Map<number, { x: number; y: number }>();
  if (dto.myNodeNum !== null) position.set(dto.myNodeNum, { x: 0, y: 0 });
  const nodes: PlacedNode[] = [];
  bands.forEach(({ ring, nums }, bandIndex) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const { inner, outer } = placements[bandIndex] ?? { inner: 0, outer: 0 };
    sorted.forEach((num, i) => {
      // Equal-area steps between the inner and outer radius fill the band evenly.
      const t = (i + 0.5) / sorted.length;
      const r = Math.sqrt(inner * inner + t * (outer * outer - inner * inner));
      const angle = i * GOLDEN_ANGLE + bandIndex * 1.1 - Math.PI / 2;
      const p = { x: round(Math.cos(angle) * r), y: round(Math.sin(angle) * r) };
      position.set(num, p);
      nodes.push({ num, ring: ringOfNum.get(num) ?? ring, ...p });
    });
  });

  const links: PlacedLink[] = [];
  // A NeighborInfo report about a pair my node already hears directly would draw a
  // dashed line over the direct one; the direct observation wins.
  const pair = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const direct = new Set(
    dto.links.filter((l) => l.kind === "direct").map((l) => pair(l.from, l.to)),
  );
  for (const l of dto.links) {
    if (l.kind === "reported" && direct.has(pair(l.from, l.to))) continue;
    const a = position.get(l.from);
    const b = position.get(l.to);
    if (!a || !b) continue;
    links.push({ ...l, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return {
    center: dto.myNodeNum,
    bands: placements.map((p, i) => ({
      ...p,
      ring: (["direct", "one", "many"] as const)[i] ?? "many",
    })),
    nodes,
    links,
    hidden: dto.nodes.length - shown.length,
    dot: dotRadius(nodes.length),
  };
}

/**
 * Band radii for these node counts (direct, 1 hop, 2+ hops): each band's share of the
 * disk's area follows its share of the nodes, but never below `MIN_BAND_SHARE`, so
 * dots spread at a similar density everywhere.
 */
export function bandPlacements(counts: readonly number[]): Omit<BandPlacement, "ring">[] {
  const inner0 = DISK_INNER * DISK_RADIUS;
  const outer0 = DISK_OUTER * DISK_RADIUS;
  const area = outer0 * outer0 - inner0 * inner0;
  const total = counts.reduce((a, b) => a + b, 0);
  const raw = counts.map((c) => (total === 0 ? 1 / counts.length : c / total));
  // Lift small bands to the minimum, taking the difference from the larger ones.
  const lifted = raw.map((x) => Math.max(MIN_BAND_SHARE, x));
  const excess = lifted.reduce((a, b) => a + b, 0) - 1;
  const big = raw.filter((x) => x > MIN_BAND_SHARE).reduce((a, b) => a + b, 0);
  const shares = lifted.map((x, i) =>
    (raw[i] ?? 0) > MIN_BAND_SHARE && big > 0 ? x - (excess * (raw[i] ?? 0)) / big : x,
  );
  let r2 = inner0 * inner0;
  return counts.map((count, i) => {
    const inner = Math.sqrt(r2);
    r2 += (shares[i] ?? 0) * area;
    return { inner: round(inner), outer: round(Math.sqrt(Math.min(r2, outer0 * outer0))), count };
  });
}

const round = (n: number) => Math.round(n * 100) / 100;
