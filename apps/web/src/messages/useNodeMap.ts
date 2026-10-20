import {
  DEFAULT_DASHBOARD_THRESHOLDS,
  type DashboardDTO,
  type DashboardThresholds,
  type MeshNode,
} from "@meshterm/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { queryKeys } from "../data/keys.js";
import { useNodes } from "../data/queries.js";

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
