import type { ActivityPage, HistoryWindow, TrafficWindow } from "@meshterm/shared";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { compareMessages, cursorFor, insertMessage } from "./apply.js";
import { api } from "./api.js";
import { queryKeys, type Conversation, type ConversationData } from "./keys.js";

export const PAGE_SIZE = 50;

/** WS events and snapshots keep the cache current, so cached data never goes stale. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: 1, refetchOnWindowFocus: false },
    },
  });
}

export function useConnections() {
  return useQuery({ queryKey: queryKeys.connections, queryFn: api.connections });
}

export function useNodes(connectionId: number | null) {
  return useQuery({
    queryKey: queryKeys.nodes(connectionId ?? 0),
    queryFn: () => api.nodes(connectionId ?? 0),
    enabled: connectionId !== null,
  });
}

/** Spark data is appended live; the whole dashboard is refreshed this often anyway. */
export const DASHBOARD_REFRESH_MS = 10 * 60_000;

/** Everything the dashboard shows, in one request, patched live by WS events. */
export function useDashboard(connectionId: number | null) {
  return useQuery({
    queryKey: queryKeys.dashboard(connectionId ?? 0),
    queryFn: () => api.dashboard(connectionId ?? 0),
    enabled: connectionId !== null,
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

/** The traffic chart refreshes this often (WS events don't cover per-bucket counts). */
export const TRAFFIC_REFRESH_MS = 60_000;

export function useTraffic(connectionId: number | null, window: TrafficWindow) {
  return useQuery({
    queryKey: queryKeys.traffic(connectionId ?? 0, window),
    queryFn: () => api.traffic(connectionId ?? 0, window),
    enabled: connectionId !== null,
    refetchInterval: TRAFFIC_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

/** Every node ever seen with a position (and those without), kept current by WS events. */
export function useMapNodes(connectionId: number | null) {
  return useQuery({
    queryKey: queryKeys.mapNodes(connectionId ?? 0),
    queryFn: () => api.mapNodes(connectionId ?? 0),
    enabled: connectionId !== null,
  });
}

/** Channels and DMs with their newest message, kept current by WS events. */
export function useConversationList(connectionId: number | null) {
  return useQuery({
    queryKey: queryKeys.conversations(connectionId ?? 0),
    queryFn: () => api.conversations(connectionId ?? 0),
    enabled: connectionId !== null,
  });
}

/** Observed links between nodes; refreshed every minute (no WS event for them). */
export function useTopology(connectionId: number | null) {
  return useQuery({
    queryKey: queryKeys.topology(connectionId ?? 0),
    queryFn: () => api.topology(connectionId ?? 0),
    enabled: connectionId !== null,
    refetchInterval: TRAFFIC_REFRESH_MS,
  });
}

/** The newest activity, kept current by `activity.new`; older pages via `loadOlderActivity`. */
export function useActivity(connectionId: number | null) {
  return useQuery({
    queryKey: queryKeys.activity(connectionId ?? 0),
    queryFn: () => api.events(connectionId ?? 0),
    enabled: connectionId !== null,
  });
}

export async function loadOlderActivity(qc: QueryClient, connectionId: number): Promise<void> {
  const key = queryKeys.activity(connectionId);
  const before = qc.getQueryData<ActivityPage>(key)?.nextBefore;
  if (!before) return;
  const page = await api.events(connectionId, before);
  qc.setQueryData<ActivityPage>(key, (data) =>
    data ? { events: [...data.events, ...page.events], nextBefore: page.nextBefore } : data,
  );
}

/** One node's stored telemetry and positions (for the details drawer). */
export function useNodeHistory(
  connectionId: number | null,
  num: number | null,
  window: HistoryWindow,
) {
  return useQuery({
    queryKey: queryKeys.history(connectionId ?? 0, num ?? 0, window),
    queryFn: () => api.nodeHistory(connectionId ?? 0, num ?? 0, window),
    enabled: connectionId !== null && num !== null,
    // History grows with new reports; a minute-old copy is fine for a drawer.
    staleTime: 60_000,
  });
}

export function useChannels(connectionId: number | null) {
  return useQuery({
    queryKey: queryKeys.channels(connectionId ?? 0),
    queryFn: () => api.channels(connectionId ?? 0),
    enabled: connectionId !== null,
  });
}

/** The newest page of a conversation, kept current by WS events. */
export function useConversation(connectionId: number | null, conversation: Conversation) {
  return useQuery({
    queryKey: queryKeys.messages(connectionId ?? 0, conversation),
    queryFn: async (): Promise<ConversationData> => {
      const page = await api.messages(connectionId ?? 0, conversation, { limit: PAGE_SIZE });
      const messages = [...page.messages].reverse();
      return { messages, cursor: page.nextCursor ?? cursorFor(messages, Infinity) };
    },
    enabled: connectionId !== null,
  });
}

/**
 * Fetches the page before the oldest cached message and prepends it. Resolves to
 * the number of messages added (0 when there is nothing older).
 */
export async function loadOlder(
  qc: QueryClient,
  connectionId: number,
  conversation: Conversation,
): Promise<number> {
  const key = queryKeys.messages(connectionId, conversation);
  const before = qc.getQueryData<ConversationData>(key)?.cursor;
  if (!before) return 0;
  const page = await api.messages(connectionId, conversation, { before, limit: PAGE_SIZE });
  let added = 0;
  qc.setQueryData<ConversationData>(key, (data) => {
    if (!data) return data;
    let messages = data.messages;
    for (const m of page.messages) {
      const next = insertMessage(messages, m);
      if (next !== messages) added++;
      messages = next;
    }
    return { messages: [...messages].sort(compareMessages), cursor: page.nextCursor };
  });
  return added;
}
