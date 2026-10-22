import type { ThemeMapStyle } from "@meshterm/shared";
import type {
  ExpressionSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import type { MapTokens } from "./map-tokens.js";

export const NODE_SOURCE = "mt-nodes";
export const LAYER = {
  clusters: "mt-clusters",
  clusterCount: "mt-cluster-count",
  nodeGlow: "mt-node-glow",
  nodes: "mt-nodes",
  labels: "mt-node-labels",
} as const;

/** Clustering per spec: radius 50 px, clusters break apart above zoom 13. */
export const CLUSTER_RADIUS = 50;
export const CLUSTER_MAX_ZOOM = 13;
export const MAX_ZOOM = 19;

export function statusColor(tokens: MapTokens): ExpressionSpecification {
  return [
    "match",
    ["get", "status"],
    "online",
    tokens.status.online,
    "recent",
    tokens.status.recent,
    "stale",
    tokens.status.stale,
    tokens.status.offline,
  ];
}

/** A cluster takes the color of the best status inside it. */
export function clusterColor(tokens: MapTokens): ExpressionSpecification {
  return [
    "match",
    ["get", "best"],
    3,
    tokens.status.online,
    2,
    tokens.status.recent,
    1,
    tokens.status.stale,
    tokens.status.offline,
  ];
}

/** Paint values that come from tokens, per layer; re-applied when the theme changes. */
export function tokenPaint(tokens: MapTokens): Record<string, Record<string, unknown>> {
  return {
    [LAYER.clusters]: {
      "circle-color": clusterColor(tokens),
      "circle-stroke-color": tokens.clusterBg,
    },
    [LAYER.nodeGlow]: {
      "circle-color": statusColor(tokens),
      "circle-opacity": tokens.glow,
    },
    [LAYER.nodes]: {
      "circle-color": statusColor(tokens),
      "circle-stroke-color": ["case", ["get", "isSelf"], tokens.self, tokens.labelHalo],
    },
  };
}

/**
 * The whole style, built in code: one raster source through MeshTerm's tile proxy
 * (attribution is rendered as our own element) plus the node layers.
 */
export function buildStyle(
  origin: string,
  tokens: MapTokens,
  mapStyle: ThemeMapStyle | null = null,
): StyleSpecification {
  const paint = tokenPaint(tokens);
  const layers: LayerSpecification[] = [
    ...baseLayers(mapStyle),
    {
      id: LAYER.clusters,
      type: "circle",
      source: NODE_SOURCE,
      filter: ["has", "point_count"],
      paint: {
        ...paint[LAYER.clusters],
        "circle-opacity": 0.85,
        "circle-stroke-width": 2,
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 23],
      },
    },
    {
      id: LAYER.clusterCount,
      type: "symbol",
      source: NODE_SOURCE,
      filter: ["has", "point_count"],
      layout: {
        "icon-image": ["concat", "mt-count-", ["to-string", ["get", "point_count"]]],
        "icon-allow-overlap": true,
      },
    },
    {
      // A soft halo under each dot, for themes that set --mt-map-node-glow.
      id: LAYER.nodeGlow,
      type: "circle",
      source: NODE_SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: {
        ...paint[LAYER.nodeGlow],
        "circle-radius": ["case", ["get", "isSelf"], 20, 15],
        "circle-blur": 1,
      },
    },
    {
      id: LAYER.nodes,
      type: "circle",
      source: NODE_SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: {
        ...paint[LAYER.nodes],
        "circle-radius": ["case", ["get", "isSelf"], 8, 6],
        "circle-stroke-width": ["case", ["get", "isSelf"], 3, 1.5],
      },
    },
    {
      id: LAYER.labels,
      type: "symbol",
      source: NODE_SOURCE,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["concat", "mt-label-", ["get", "label"]],
        "icon-anchor": "top",
        "icon-offset": [0, 7],
        // Labels give way to each other when crowded; dots always show.
        "icon-allow-overlap": false,
        "symbol-sort-key": ["-", 0, ["get", "rank"]],
      },
    },
  ];
  return {
    version: 8,
    sources: {
      "mt-base": {
        type: "raster",
        tiles: [`${origin}/api/tiles/{z}/{x}/{y}.png`],
        tileSize: 256,
        maxzoom: MAX_ZOOM,
      },
      [NODE_SOURCE]: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterProperties: { best: ["max", ["get", "rank"]] },
      },
    },
    layers,
  };
}

/** Paint without unset properties (MapLibre takes no `undefined` values). */
const defined = (paint: object | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(paint ?? {}).filter(([, v]) => v !== undefined));

/** The base map's layers start with this id; MeshTerm's own layers are drawn above them. */
const BASE_PREFIX = "mt-base";

/**
 * The base map from a theme's `map-style.json` (CR-004 §8.3): its background and raster
 * layers, every raster drawn from MeshTerm's tile proxy (`mt-base` source) whatever the
 * theme named. Without a style, or a style with no raster layer, the plain tiles.
 */
export function baseLayers(mapStyle: ThemeMapStyle | null): LayerSpecification[] {
  const out: LayerSpecification[] = [];
  for (const layer of mapStyle?.layers ?? []) {
    if (layer.type === "background") {
      out.push({
        id: `${BASE_PREFIX}-${layer.id}`,
        type: "background",
        paint: defined(layer.paint),
      });
    } else if (layer.type === "raster") {
      out.push({
        id: `${BASE_PREFIX}-${layer.id}`,
        type: "raster",
        source: BASE_PREFIX,
        paint: defined(layer.paint),
      });
    }
  }
  if (!out.some((l) => l.type === "raster")) {
    out.push({ id: BASE_PREFIX, type: "raster", source: BASE_PREFIX });
  }
  return out;
}

/**
 * Swaps the base map for a theme's (CR-004 §8.3) without touching the camera or
 * MeshTerm's own sources and layers: the old base layers go, the new ones go below them.
 */
export function applyBaseLayers(map: MapLibreMap, mapStyle: ThemeMapStyle | null): void {
  for (const layer of map.getStyle().layers) {
    if (layer.id === BASE_PREFIX || layer.id.startsWith(`${BASE_PREFIX}-`)) {
      map.removeLayer(layer.id);
    }
  }
  const below = map.getStyle().layers[0]?.id;
  for (const layer of baseLayers(mapStyle)) map.addLayer(layer, below);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The CSS that gives the dashboard's mini maps (plain tile images) the same look as the
 * theme's base map: a filter equivalent to the raster paint, and the background color
 * that shows through a transparent raster.
 */
export function miniMapLook(mapStyle: ThemeMapStyle | null): {
  filter: string;
  background: string | null;
} {
  const raster = mapStyle?.layers.find((l) => l.type === "raster");
  const bg = mapStyle?.layers.find((l) => l.type === "background");
  const paint = raster?.type === "raster" ? (raster.paint ?? {}) : {};
  const parts: string[] = [];
  const min = paint["raster-brightness-min"] ?? 0;
  const max = paint["raster-brightness-max"] ?? 1;
  // MapLibre maps brightness 0–1 onto min–max; min above max inverts the tiles.
  if (min > max) parts.push("invert(1)", `brightness(${round(min - max)})`);
  else if (max < 1) parts.push(`brightness(${round(max)})`);
  const saturation = paint["raster-saturation"] ?? 0;
  if (saturation !== 0) {
    const s = saturation < 0 ? 1 + saturation : 1 / Math.max(0.01, 1 - saturation);
    parts.push(`saturate(${round(s)})`);
  }
  const contrast = paint["raster-contrast"] ?? 0;
  if (contrast !== 0) {
    const c = contrast < 0 ? 1 + contrast : 1 / Math.max(0.01, 1 - contrast);
    parts.push(`contrast(${round(c)})`);
  }
  const hue = paint["raster-hue-rotate"] ?? 0;
  if (hue !== 0) parts.push(`hue-rotate(${hue}deg)`);
  const opacity = paint["raster-opacity"] ?? 1;
  if (opacity < 1) parts.push(`opacity(${round(opacity)})`);
  const color = bg?.type === "background" ? (bg.paint?.["background-color"] ?? null) : null;
  return { filter: parts.length > 0 ? parts.join(" ") : "none", background: color };
}
