import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapTokens } from "./map-tokens.js";

export const NODE_SOURCE = "mt-nodes";
export const LAYER = {
  clusters: "mt-clusters",
  clusterCount: "mt-cluster-count",
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
export function buildStyle(origin: string, tokens: MapTokens): StyleSpecification {
  const paint = tokenPaint(tokens);
  const layers: LayerSpecification[] = [
    { id: "mt-base", type: "raster", source: "mt-base" },
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
