import type {
  DashboardThresholds,
  MapNodeFeature,
  MapNodesDTO,
  MeshNode,
  NodePosition,
  NodeStatusName,
  TelemetryReport,
} from "@meshterm/shared";
import { precisionRadiusMeters } from "../dashboard/geo.js";
import { nodeStatus } from "../dashboard/view.js";

/** Higher is better; clusters take the best status inside them. */
export const STATUS_RANK: Record<NodeStatusName, number> = {
  online: 3,
  recent: 2,
  stale: 1,
  offline: 0,
};

export const RANK_STATUS: NodeStatusName[] = ["offline", "stale", "recent", "online"];

/**
 * Pure patches of the cached map data from WS events. Each returns the same object
 * when nothing changed. A node seen for the first time joins `unplaced` until it
 * reports a position; a position for an unplaced node turns it into a feature.
 */
export function applyNodeToMap(data: MapNodesDTO, node: MeshNode): MapNodesDTO {
  const i = data.features.findIndex((f) => f.id === node.num);
  const feature = data.features[i];
  if (feature) {
    const p = feature.properties;
    const next = {
      ...p,
      shortName: node.shortName,
      longName: node.longName,
      role: node.role,
      lastHeard: node.lastHeard,
      hopsAway: node.hopsAway,
      snr: p.isSelf ? null : node.snr,
      isFavorite: node.isFavorite,
    };
    if ((Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === p[k])) {
      return data;
    }
    const features = [...data.features];
    features[i] = { ...feature, properties: next };
    return { ...data, features };
  }
  const j = data.unplaced.findIndex((u) => u.num === node.num);
  const entry = {
    num: node.num,
    userId: node.id,
    shortName: node.shortName,
    longName: node.longName,
    lastHeard: node.lastHeard,
  };
  const unplaced = [...data.unplaced];
  if (j < 0) unplaced.push(entry);
  else unplaced[j] = entry;
  return { ...data, unplaced };
}

export function applyPositionToMap(
  data: MapNodesDTO,
  position: NodePosition,
  myNodeNum: number | null,
): MapNodesDTO {
  const coordinates: [number, number] = [position.lon, position.lat];
  const precisionMeters = precisionRadiusMeters(position.precisionBits);
  const i = data.features.findIndex((f) => f.id === position.nodeNum);
  const feature = data.features[i];
  if (feature) {
    if (feature.properties.positionTime > position.time) return data;
    const features = [...data.features];
    features[i] = {
      ...feature,
      geometry: { type: "Point", coordinates },
      properties: {
        ...feature.properties,
        positionTime: position.time,
        precisionMeters: precisionMeters === null ? null : Math.round(precisionMeters),
      },
    };
    return { ...data, features };
  }
  const known = data.unplaced.find((u) => u.num === position.nodeNum);
  const fresh: MapNodeFeature = {
    type: "Feature",
    id: position.nodeNum,
    geometry: { type: "Point", coordinates },
    properties: {
      num: position.nodeNum,
      userId: known?.userId ?? `!${position.nodeNum.toString(16).padStart(8, "0")}`,
      shortName: known?.shortName ?? "",
      longName: known?.longName ?? "",
      role: null,
      status: "offline",
      lastHeard: known?.lastHeard ?? position.time,
      isSelf: position.nodeNum === myNodeNum,
      isFavorite: false,
      precisionMeters: precisionMeters === null ? null : Math.round(precisionMeters),
      batteryLevel: null,
      hopsAway: null,
      snr: null,
      positionTime: position.time,
    },
  };
  return {
    ...data,
    features: [...data.features, fresh],
    unplaced: data.unplaced.filter((u) => u.num !== position.nodeNum),
  };
}

export function applyTelemetryToMap(data: MapNodesDTO, report: TelemetryReport): MapNodesDTO {
  if (report.kind !== "device" || report.device.batteryLevel === null) return data;
  const i = data.features.findIndex((f) => f.id === report.nodeNum);
  const feature = data.features[i];
  if (!feature || feature.properties.batteryLevel === report.device.batteryLevel) return data;
  const features = [...data.features];
  features[i] = {
    ...feature,
    properties: { ...feature.properties, batteryLevel: report.device.batteryLevel },
  };
  return { ...data, features };
}

/** What the map source gets: statuses recomputed for `now`, plus a numeric rank and label. */
export interface MapSourceProperties {
  num: number;
  status: NodeStatusName;
  rank: number;
  isSelf: boolean;
  isFavorite: boolean;
  label: string;
}

export interface MapSource {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: number;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: MapSourceProperties;
  }[];
}

export function toMapSource(
  data: MapNodesDTO,
  now: number,
  thresholds: DashboardThresholds = data.thresholds,
): MapSource {
  return {
    type: "FeatureCollection",
    features: data.features.map((f) => {
      const status = nodeStatus(f.properties.lastHeard, now, thresholds);
      return {
        type: "Feature",
        id: f.id,
        geometry: { type: "Point", coordinates: f.geometry.coordinates },
        properties: {
          num: f.properties.num,
          status,
          rank: STATUS_RANK[status],
          isSelf: f.properties.isSelf,
          isFavorite: f.properties.isFavorite,
          label: labelOf(f),
        },
      };
    }),
  };
}

/** Short name, or the end of the node ID; favorites get a star. */
export function labelOf(f: MapNodeFeature): string {
  const name = f.properties.shortName || f.properties.userId.slice(-4);
  return f.properties.isFavorite ? `★ ${name}` : name;
}

/** [[west, south], [east, north]] around all features; null when there are none. */
export function boundsOf(
  features: readonly MapNodeFeature[],
): [[number, number], [number, number]] | null {
  if (features.length === 0) return null;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

export interface MapViewport {
  center: [number, number];
  zoom: number;
}

export const VIEWPORT_KEY = "meshterm.mapView";

export function readViewport(): MapViewport | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(VIEWPORT_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const { center, zoom } = raw as { center?: unknown; zoom?: unknown };
    if (
      !Array.isArray(center) ||
      center.length !== 2 ||
      !center.every((n) => typeof n === "number" && Number.isFinite(n)) ||
      typeof zoom !== "number" ||
      !Number.isFinite(zoom)
    ) {
      return null;
    }
    return { center: [center[0] as number, center[1] as number], zoom };
  } catch {
    return null;
  }
}

export function writeViewport(viewport: MapViewport): void {
  try {
    localStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport));
  } catch {
    // Not remembered.
  }
}
