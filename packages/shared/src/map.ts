import { z } from "zod";
import { DashboardThresholds } from "./dashboard.js";
import { EpochMs, Uint32 } from "./domain.js";

/** Last-heard status, same thresholds as the dashboard. */
export const NodeStatusName = z.enum(["online", "recent", "stale", "offline"]);
export type NodeStatusName = z.infer<typeof NodeStatusName>;

export const MapNodeProperties = z.object({
  num: Uint32,
  userId: z.string(),
  shortName: z.string(),
  longName: z.string(),
  role: z.string().nullable(),
  status: NodeStatusName,
  lastHeard: EpochMs.nullable(),
  isSelf: z.boolean(),
  isFavorite: z.boolean(),
  /** Radius of a deliberately coarsened position; null when exact. */
  precisionMeters: z.number().nullable(),
  batteryLevel: z.number().int().nullable(),
  hopsAway: z.number().int().nonnegative().nullable(),
  snr: z.number().nullable(),
  /** When the position was reported. */
  positionTime: EpochMs,
});
export type MapNodeProperties = z.infer<typeof MapNodeProperties>;

export const MapNodeFeature = z.object({
  type: z.literal("Feature"),
  /** The node number, so MapLibre can address features. */
  id: Uint32,
  geometry: z.object({
    type: z.literal("Point"),
    /** `[lon, lat]`, as GeoJSON orders them. */
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: MapNodeProperties,
});
export type MapNodeFeature = z.infer<typeof MapNodeFeature>;

/**
 * `GET /api/connections/:id/map/nodes?since=`: a GeoJSON FeatureCollection of every
 * node with a stored position (all time unless `since`), plus two foreign members:
 * the nodes heard but never placed, and the status thresholds.
 */
export const MapNodesDTO = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(MapNodeFeature),
  unplaced: z.array(
    z.object({
      num: Uint32,
      userId: z.string(),
      shortName: z.string(),
      longName: z.string(),
      lastHeard: EpochMs.nullable(),
    }),
  ),
  thresholds: DashboardThresholds,
});
export type MapNodesDTO = z.infer<typeof MapNodesDTO>;
