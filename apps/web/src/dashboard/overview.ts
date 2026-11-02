// The Overview's choices (CR-005 §6.2), kept out of the components so they can be tested:
// which nodes the hero map shows, how the headline reads, the roster's order, the map's
// framing and the gauges' arcs.
import type { CardPosition, DashboardThresholds, NodeCard } from "@meshterm/shared";
import {
  bearingDegrees,
  cardinal,
  formatDistance,
  haversineMeters,
  metersPerPixel,
  TILE_SIZE,
  tileCoords,
  type LatLon,
} from "./geo.js";

const heardWithin = (card: NodeCard, now: number, minutes: number) =>
  card.lastHeard !== null && now - card.lastHeard < minutes * 60_000;

const nameOf = (c: NodeCard) => c.longName || c.shortName || c.userId;

/**
 * The nodes on the hero map: my node, plus every other node with a position heard
 * within the "recent" window (2 h by default). A big mesh stays readable that way.
 */
export function heroNodes(
  cards: readonly NodeCard[],
  now: number,
  thresholds: DashboardThresholds,
): (NodeCard & { position: CardPosition })[] {
  return cards.filter(
    (c): c is NodeCard & { position: CardPosition } =>
      c.position !== null && (c.isSelf || heardWithin(c, now, thresholds.recentMin)),
  );
}

const hoursLabel = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;

/**
 * The hero's headline and the sentence under it: how many other nodes were heard in the
 * recent window, how many directly, and the nearest and farthest of those with a position.
 */
export function heroHeadline(
  cards: readonly NodeCard[],
  now: number,
  thresholds: DashboardThresholds,
): { title: string; detail: string } {
  const others = cards.filter((c) => !c.isSelf);
  const window = hoursLabel(thresholds.recentMin);
  if (others.length === 0) {
    return {
      title: "Only your node so far",
      detail: "Other nodes appear here as soon as one is heard on the mesh.",
    };
  }
  const heard = others.filter((c) => heardWithin(c, now, thresholds.recentMin));
  if (heard.length === 0) {
    return {
      title: `No nodes heard in the last ${window}`,
      detail: `${others.length} known ${others.length === 1 ? "node" : "nodes"}; none has been heard recently.`,
    };
  }
  const title = `${heard.length} of ${others.length} ${others.length === 1 ? "node" : "nodes"} on the air`;
  const parts: string[] = [];
  const direct = heard.filter((c) => c.hopsAway === 0).length;
  parts.push(`${direct} heard direct`);
  const origin = cards.find((c) => c.isSelf)?.position ?? null;
  if (origin) {
    const placed = heard
      .filter((c): c is NodeCard & { position: CardPosition } => c.position !== null)
      .map((c) => ({ c, d: haversineMeters(origin, c.position) }))
      .sort((a, b) => a.d - b.d);
    const nearest = placed[0];
    const farthest = placed[placed.length - 1];
    if (nearest) parts.push(`nearest ${nameOf(nearest.c)} ${formatDistance(nearest.d)}`);
    if (farthest && farthest !== nearest) {
      const dir = cardinal(bearingDegrees(origin, farthest.c.position));
      parts.push(`farthest ${nameOf(farthest.c)}, ${formatDistance(farthest.d)} ${dir}`);
    }
  }
  return { title, detail: `${parts.join(" · ")} · last ${window}` };
}

/** The Overview's roster: my node, favorites, then the most recently heard; at most `limit`. */
export function rosterCards(cards: readonly NodeCard[], limit: number): NodeCard[] {
  const heardFirst = (a: NodeCard, b: NodeCard) =>
    (b.lastHeard ?? -1) - (a.lastHeard ?? -1) || a.num - b.num;
  const self = cards.filter((c) => c.isSelf);
  const favorites = cards.filter((c) => !c.isSelf && c.isFavorite).sort(heardFirst);
  const rest = cards.filter((c) => !c.isSelf && !c.isFavorite).sort(heardFirst);
  return [...self, ...favorites, ...rest].slice(0, limit);
}

export interface HeroFrame {
  z: number;
  /** World pixel (at zoom z) of the frame's top-left corner. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Tiles that cover the frame, with their place in it (pixels). */
  tiles: { x: number; y: number; px: number; py: number }[];
  /** A position's place in the frame, in pixels. */
  project: (p: LatLon) => { x: number; y: number };
  /** Pixels per meter at the frame's center. */
  pxPerMeter: number;
}

/**
 * Frames the given positions in a `width` × `height` box: the highest zoom (3–15) where
 * they all fit inside `pad` pixels, centered on them. One position gets zoom 13.
 */
export function heroFrame(
  points: readonly LatLon[],
  width: number,
  height: number,
  pad = 48,
): HeroFrame | null {
  if (points.length === 0 || width <= 0 || height <= 0) return null;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const bounds = {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lons),
    west: Math.min(...lons),
  };
  let z = points.length === 1 ? 13 : 15;
  for (; z > 3; z--) {
    const nw = tileCoords({ lat: bounds.north, lon: bounds.west }, z);
    const se = tileCoords({ lat: bounds.south, lon: bounds.east }, z);
    const w = (se.x - nw.x) * TILE_SIZE;
    const h = (se.y - nw.y) * TILE_SIZE;
    if (w <= width - 2 * pad && h <= height - 2 * pad) break;
  }
  const nw = tileCoords({ lat: bounds.north, lon: bounds.west }, z);
  const se = tileCoords({ lat: bounds.south, lon: bounds.east }, z);
  const cx = ((nw.x + se.x) / 2) * TILE_SIZE;
  const cy = ((nw.y + se.y) / 2) * TILE_SIZE;
  const left = cx - width / 2;
  const top = cy - height / 2;
  const n = 2 ** z;
  const tiles: HeroFrame["tiles"] = [];
  for (let ty = Math.floor(top / TILE_SIZE); ty * TILE_SIZE < top + height; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE_SIZE); tx * TILE_SIZE < left + width; tx++) {
      tiles.push({
        x: ((tx % n) + n) % n,
        y: ty,
        px: tx * TILE_SIZE - left,
        py: ty * TILE_SIZE - top,
      });
    }
  }
  const centerLat = (bounds.north + bounds.south) / 2;
  return {
    z,
    left,
    top,
    width,
    height,
    tiles,
    project: (p) => {
      const t = tileCoords(p, z);
      return { x: t.x * TILE_SIZE - left, y: t.y * TILE_SIZE - top };
    },
    pxPerMeter: 1 / metersPerPixel(centerLat, z),
  };
}

/**
 * Which labels to show so none overlap: in the given priority order, a label is kept
 * when its box (to the right of the pin) doesn't touch one already kept.
 */
export function visibleLabels(
  pins: readonly { num: number; x: number; y: number; chars: number }[],
  charWidth = 7.5,
  height = 16,
): Set<number> {
  const kept: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const out = new Set<number>();
  for (const p of pins) {
    const box = { x1: p.x + 8, y1: p.y - height, x2: p.x + 14 + p.chars * charWidth, y2: p.y };
    if (kept.some((k) => box.x1 < k.x2 && box.x2 > k.x1 && box.y1 < k.y2 && box.y2 > k.y1)) {
      continue;
    }
    kept.push(box);
    out.add(p.num);
  }
  return out;
}

/** The arc of a gauge: 252° from lower left to lower right, as an SVG path. */
export function gaugeArc(fraction: number, r = 46, cx = 60, cy = 58): string {
  const start = Math.PI * 0.8;
  const sweep = Math.PI * 1.4;
  const f = Math.max(0, Math.min(1, fraction));
  const a = start + sweep * f;
  const x0 = cx + Math.cos(start) * r;
  const y0 = cy + Math.sin(start) * r;
  const x1 = cx + Math.cos(a) * r;
  const y1 = cy + Math.sin(a) * r;
  const large = sweep * f > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Where on the arc a fraction falls (for the threshold tick). */
export function gaugePoint(
  fraction: number,
  r: number,
  cx = 60,
  cy = 58,
): { x: number; y: number } {
  const a = Math.PI * 0.8 + Math.PI * 1.4 * Math.max(0, Math.min(1, fraction));
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}
