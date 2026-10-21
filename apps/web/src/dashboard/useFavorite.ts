import type { DashboardDTO, NodeDetailDTO } from "@meshterm/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useIsAdmin } from "../auth/me.js";
import { api } from "../data/api.js";
import { applyFavorite } from "../data/dashboard-cache.js";
import { queryKeys } from "../data/keys.js";

/**
 * Toggles a node's local favorite: the card flips at once, the server confirms with a
 * `node.upsert`, and a failed request flips it back.
 */
export function useToggleFavorite(connectionId: number | null) {
  const qc = useQueryClient();
  const admin = useIsAdmin();
  return useCallback(
    async (num: number, favorite: boolean) => {
      // Viewers can't change favorites (the server refuses too).
      if (connectionId === null || !admin) return;
      const key = queryKeys.dashboard(connectionId);
      const set = (value: boolean) => {
        qc.setQueryData<DashboardDTO>(key, (d) => (d ? applyFavorite(d, num, value) : d));
        qc.setQueryData<NodeDetailDTO>(queryKeys.nodeDetail(connectionId, num), (d) =>
          d ? { ...d, isFavorite: value } : d,
        );
      };
      set(favorite);
      try {
        await api.setFavorite(connectionId, num, favorite);
      } catch (err) {
        set(!favorite);
        console.warn("MeshTerm: favorite not saved", err);
      }
    },
    [connectionId, qc, admin],
  );
}
