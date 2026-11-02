import type { MapNodeFeature, MapNodesDTO } from "@meshterm/shared";
import { signalQuality, type SignalQuality } from "../dashboard/insights.js";
import { bearingDegrees, cardinal, formatDistance, haversineMeters } from "../dashboard/geo.js";

/** Range rings around my node (CR-005 §6.3). */
export const RING_KM = [2, 5, 10] as const;
const RING_SEGMENTS = 96;
const EARTH_RADIUS_M = 6_371_008.8;

export interface LayerPrefs {
  links: boolean;
  rings: boolean;
}

export const LAYER_PREFS_KEY = "meshterm.mapLayers";
export const DEFAULT_LAYER_PREFS: LayerPrefs = { links: true, rings: true };

/** The layer toggles as the reader left them in this browser, if storage allows. */
export function readLayerPrefs(): LayerPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LAYER_PREFS_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const r = raw as Partial<Record<keyof LayerPrefs, unknown>>;
      return {
        links: typeof r.links === "boolean" ? r.links : DEFAULT_LAYER_PREFS.links,
        rings: typeof r.rings === "boolean" ? r.rings : DEFAULT_LAYER_PREFS.rings,
      };
    }
  } catch {
    // Unreadable or blocked: the defaults.
  }
  return DEFAULT_LAYER_PREFS;
}

export function writeLayerPrefs(prefs: LayerPrefs): void {
  try {
    localStorage.setItem(LAYER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: nothing to remember.
  }
}

type Lonlat = [number, number];

interface LineFeature<P> {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Lonlat[] };
  properties: P;
}

interface PointFeature<P> {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Lonlat };
  properties: P;
}

export interface Collection<F> {
  type: "FeatureCollection";
  features: F[];
}

const empty = <F>(): Collection<F> => ({ type: "FeatureCollection", features: [] });

export const selfOf = (data: MapNodesDTO): MapNodeFeature | null =>
  data.features.find((f) => f.properties.isSelf) ?? null;

const latLon = ([lon, lat]: Lonlat) => ({ lat, lon });

export interface LinkProperties {
  num: number;
  quality: SignalQuality;
  /** "7.25 dB"; empty when the SNR isn't known. */
  label: string;
}

/**
 * Lines from my node to every node it heard directly (`hopsAway` 0), colored by the
 * SNR of the last packet heard (CR-005 §6.3). Nothing without my node's position.
 */
export function directLinks(data: MapNodesDTO): Collection<LineFeature<LinkProperties>> {
  const self = selfOf(data);
  if (!self) return empty();
  const out = empty<LineFeature<LinkProperties>>();
  for (const f of data.features) {
    const p = f.properties;
    if (p.isSelf || p.hopsAway !== 0) continue;
    out.features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [self.geometry.coordinates, f.geometry.coordinates],
      },
      properties: {
        num: p.num,
        quality: signalQuality(p.snr),
        label: p.snr === null ? "" : `${p.snr} dB`,
      },
    });
  }
  return out;
}

/** The point `meters` from `center` on `bearing` (degrees), on a sphere. */
export function destination(center: Lonlat, meters: number, bearing: number): Lonlat {
  const rad = Math.PI / 180;
  const [lon, lat] = center;
  const d = meters / EARTH_RADIUS_M;
  const b = bearing * rad;
  const lat1 = lat * rad;
  const lon1 = lon * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [((lon2 / rad + 540) % 360) - 180, lat2 / rad];
}

export interface RingProperties {
  km: number;
  label: string;
}

/** Closed circles of `RING_KM` around my node, and a label point at the top of each. */
export function rangeRings(data: MapNodesDTO): {
  rings: Collection<LineFeature<RingProperties>>;
  labels: Collection<PointFeature<RingProperties>>;
} {
  const self = selfOf(data);
  const rings = empty<LineFeature<RingProperties>>();
  const labels = empty<PointFeature<RingProperties>>();
  if (!self) return { rings, labels };
  const center = self.geometry.coordinates;
  for (const km of RING_KM) {
    const properties = { km, label: `${km} km` };
    const coordinates: Lonlat[] = [];
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      coordinates.push(destination(center, km * 1000, (i * 360) / RING_SEGMENTS));
    }
    rings.features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties,
    });
    labels.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: destination(center, km * 1000, 0) },
      properties,
    });
  }
  return { rings, labels };
}

export interface NearestEntry {
  feature: MapNodeFeature;
  /** Null without my node's position. */
  meters: number | null;
  /** "4.6 km NE", or null. */
  where: string | null;
}

/**
 * Every other node with a position, nearest first (CR-005 §6.3); without my node's
 * position, most recently heard first.
 */
export function nearestNodes(data: MapNodesDTO): NearestEntry[] {
  const self = selfOf(data);
  const origin = self ? latLon(self.geometry.coordinates) : null;
  const entries = data.features
    .filter((f) => !f.properties.isSelf)
    .map((feature): NearestEntry => {
      if (!origin) return { feature, meters: null, where: null };
      const at = latLon(feature.geometry.coordinates);
      const meters = haversineMeters(origin, at);
      return {
        feature,
        meters,
        where: `${formatDistance(meters)} ${cardinal(bearingDegrees(origin, at))}`,
      };
    });
  return entries.sort(
    (a, b) =>
      (a.meters ?? Infinity) - (b.meters ?? Infinity) ||
      (b.feature.properties.lastHeard ?? -1) - (a.feature.properties.lastHeard ?? -1) ||
      a.feature.properties.num - b.feature.properties.num,
  );
}
