import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { startLeader } from "./center.js";
import { useFaviconBadge, useTabTitle } from "./tab.js";

/** The user's notification settings; kept fresh by `notification-prefs.updated`. */
export function useNotificationPrefs() {
  return useQuery({
    queryKey: queryKeys.notificationPrefs,
    queryFn: api.notificationPrefs,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Everything notifications need while the app runs (mounted once in the shell): the
 * user's settings, this tab's part in the leader election, the title and the favicon.
 */
export function useNotificationRuntime(count: number, priority: boolean): void {
  useNotificationPrefs();
  useEffect(() => startLeader(), []);
  useTabTitle(count);
  useFaviconBadge(count, priority);
}
