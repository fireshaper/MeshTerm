import {
  DEFAULT_DASHBOARD_THRESHOLDS,
  type DashboardDTO,
  type DashboardThresholds,
  type MeshNode,
} from "@meshterm/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { queryKeys } from "../data/keys.js";
import { useMapNodes, useNodes } from "../data/queries.js";
import type { LatLon } from "../dashboard/geo.js";

/** Nodes of the connection by number (from the snapshot-fed node list). */
export function useNodeMap(connectionId: number | null): ReadonlyMap<number, MeshNode> {
  const { data } = useNodes(connectionId);
  return useMemo(() => new Map((data ?? []).map((n) => [n.num, n])), [data]);
}

/**
 * Online/recent/stale thresholds: the server's when the dashboard is already cached,
 * else the defaults. Never fetches the dashboard just for this.
 */
export function useThresholds(connectionId: number | null): DashboardThresholds {
  const { data } = useQuery<DashboardDTO>({
    queryKey: queryKeys.dashboard(connectionId ?? 0),
    enabled: false,
  });
  return data?.thresholds ?? DEFAULT_DASHBOARD_THRESHOLDS;
}

export interface Positions {
  /** My node's position, the origin for distances. */
  origin: LatLon | null;
  byNum: ReadonlyMap<number, LatLon>;
}

/** Node positions from the map's node list (kept current by WS events). */
export function usePositions(connectionId: number | null): Positions {
  const { data } = useMapNodes(connectionId);
  return useMemo(() => {
    const byNum = new Map<number, LatLon>();
    let origin: LatLon | null = null;
    for (const f of data?.features ?? []) {
      const [lon, lat] = f.geometry.coordinates;
      byNum.set(f.properties.num, { lat, lon });
      if (f.properties.isSelf) origin = { lat, lon };
    }
    return { origin, byNum };
  }, [data]);
}
