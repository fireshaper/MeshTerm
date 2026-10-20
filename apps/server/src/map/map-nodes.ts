import { nodeIdFromNum, type MapNodesDTO, type NodeStatusName } from "@meshterm/shared";
import { and, eq, gte } from "drizzle-orm";
import { getThresholds } from "../dashboard/dashboard.js";
import type { Db } from "../db/database.js";
import { getMyNodeNum } from "../db/repositories.js";
import { nodes } from "../db/schema.js";

/** Meshtastic coarsening: 10 bits ≈ 23.3 km, halving per extra bit; null when exact. */
export function precisionMeters(bits: number | null): number | null {
  if (bits === null || bits <= 0 || bits >= 32) return null;
  return Math.round(23_300 * 2 ** (10 - bits));
}

export function statusOf(
  lastHeard: number | null,
  now: number,
  t: { onlineMin: number; recentMin: number; staleMin: number },
): NodeStatusName {
  if (lastHeard === null) return "offline";
  const minutes = (now - lastHeard) / 60_000;
  if (minutes < t.onlineMin) return "online";
  if (minutes < t.recentMin) return "recent";
  if (minutes < t.staleMin) return "stale";
  return "offline";
}

/**
 * Every node with a stored position as a GeoJSON point (old and offline ones too,
 * unless `since` limits by last heard), plus the nodes without one. One query.
 */
export function buildMapNodes(
  db: Db,
  connectionId: number,
  now: number,
  since: number | null = null,
): MapNodesDTO {
  const thresholds = getThresholds(db);
  const myNodeNum = getMyNodeNum(db, connectionId);
  const rows = db
    .select()
    .from(nodes)
    .where(
      since === null
        ? eq(nodes.connectionId, connectionId)
        : and(eq(nodes.connectionId, connectionId), gte(nodes.lastHeard, since)),
    )
    .all();
  const features: MapNodesDTO["features"] = [];
  const unplaced: MapNodesDTO["unplaced"] = [];
  for (const n of rows) {
    const base = {
      num: n.num,
      userId: nodeIdFromNum(n.num),
      shortName: n.shortName,
      longName: n.longName,
      lastHeard: n.lastHeard,
    };
    if (n.lat === null || n.lon === null || n.positionTime === null) {
      unplaced.push(base);
      continue;
    }
    features.push({
      type: "Feature",
      id: n.num,
      geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: {
        ...base,
        role: n.role,
        status: statusOf(n.lastHeard, now, thresholds),
        isSelf: n.num === myNodeNum,
        isFavorite: n.favoriteOverride ?? n.isFavorite,
        precisionMeters: precisionMeters(n.precisionBits),
        batteryLevel: n.batteryLevel,
        hopsAway: n.hopsAway,
        snr: n.num === myNodeNum ? null : n.snr,
        positionTime: n.positionTime,
      },
    });
  }
  unplaced.sort((a, b) => (b.lastHeard ?? -1) - (a.lastHeard ?? -1) || a.num - b.num);
  return { type: "FeatureCollection", features, unplaced, thresholds };
}
