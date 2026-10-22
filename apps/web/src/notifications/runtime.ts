import type { MeshNode } from "@meshterm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { groupOf, onConversationRead, onLeaderAlert, startLeader } from "./center.js";
import { closeDesktopNotification, showDesktopNotification } from "./desktop.js";
import { useBrowserNotifySettings } from "./settings.js";
import { SoundPlayer } from "./sounds.js";
import { useFaviconBadge, useTabTitle } from "./tab.js";

/** The user's notification settings; kept fresh by `notification-prefs.updated`. */
export function useNotificationPrefs() {
  return useQuery({
    queryKey: queryKeys.notificationPrefs,
    queryFn: api.notificationPrefs,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Sounds and OS notifications for the leader tab (CR-003 §7, §8). */
function useAlertOutlets(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const player = new SoundPlayer();
    void player.load();
    const unlock = () => {
      player.unlock();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    const offAlert = onLeaderAlert((event) => {
      const { settings } = useBrowserNotifySettings.getState();
      if (event.alert.sound) player.play(event.alert.sound, settings.volume);
      if (event.alert.os) {
        const from = event.message?.fromNum;
        const nodes =
          event.target && qc.getQueryData<MeshNode[]>(queryKeys.nodes(event.target.connectionId));
        const longName = nodes ? (nodes.find((n) => n.num === from)?.longName ?? null) : null;
        showDesktopNotification(event, longName, settings.hideText);
      }
    });
    const offRead = onConversationRead((target) => {
      closeDesktopNotification(groupOf(target));
    });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      offAlert();
      offRead();
    };
  }, [qc]);
}

/**
 * Everything notifications need while the app runs (mounted once in the shell): the
 * user's settings, this tab's part in the leader election, sounds and OS notifications,
 * the title and the favicon.
 */
export function useNotificationRuntime(count: number, priority: boolean): void {
  useNotificationPrefs();
  useEffect(() => startLeader(), []);
  useAlertOutlets();
  useTabTitle(count);
  useFaviconBadge(count, priority);
}
