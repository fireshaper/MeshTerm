import {
  messageCursor,
  SNAPSHOT_MESSAGES,
  type MeshNode,
  type Message,
  type ServerMessage,
  type ServerMessageOf,
} from "@meshterm/shared";
import type {
  ActivityPage,
  ConversationsDTO,
  DashboardDTO,
  MapNodesDTO,
  NodeDetailDTO,
  SeriesDTO,
} from "@meshterm/shared";
import { applyNodeToMap, applyPositionToMap, applyTelemetryToMap } from "../map/map-data.js";
import { applyReportToSeries } from "../node-drawer/charts/series-data.js";
import type { QueryClient } from "@tanstack/react-query";
import {
  applyConnectionState,
  applyMessage,
  applyNodeUpsert,
  applyPosition,
  applyTelemetry,
} from "./dashboard-cache.js";
import {
  applyMessageToConversations,
  applyReadToConversations,
  applyStateToConversations,
  applyStatusToConversations,
} from "./conversations-cache.js";
import { handleBacklog, handleMessageNew, markConversationRead } from "../notifications/center.js";
import {
  applyNodeToDetail,
  applyPositionToDetail,
  applyTelemetryToDetail,
} from "./node-detail-cache.js";
import { conversationOf, queryKeys, type ConversationData } from "./keys.js";
import { useLiveStore } from "./store.js";

/** Messages ordered as the UI shows them: oldest first, ties broken by id (as the server pages). */
export function compareMessages(a: Message, b: Message): number {
  return a.rxTime - b.rxTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Inserts in order; returns the same array when the id is already there. */
export function insertMessage(list: Message[], message: Message): Message[] {
  if (list.some((m) => m.id === message.id)) return list;
  const next = [...list];
  let i = next.length;
  while (i > 0 && compareMessages(next[i - 1] as Message, message) > 0) i--;
  next.splice(i, 0, message);
  return next;
}

/** Cursor for what's older than `messages`, given how many the server returned. */
export function cursorFor(messages: Message[], pageSize: number): string | null {
  const oldest = messages[0];
  return oldest && messages.length >= pageSize ? messageCursor(oldest) : null;
}

/** Replaces everything cached for the snapshot's connection: the snapshot is the source of truth. */
export function applySnapshot(qc: QueryClient, snapshot: ServerMessageOf<"snapshot">): void {
  const { connectionId } = snapshot;
  qc.setQueryData(queryKeys.nodes(connectionId), snapshot.nodes);
  qc.setQueryData(queryKeys.channels(connectionId), snapshot.channels);

  const seeded = new Set<string>();
  const seed = (key: ReturnType<typeof queryKeys.messages>, messages: Message[]) => {
    const data: ConversationData = { messages, cursor: cursorFor(messages, SNAPSHOT_MESSAGES) };
    qc.setQueryData(key, data);
    seeded.add(JSON.stringify(key));
  };
  for (const { channelIndex, messages } of snapshot.channelMessages) {
    seed(queryKeys.messages(connectionId, { channel: channelIndex }), messages);
  }
  for (const { peer, messages } of snapshot.dmMessages) {
    seed(queryKeys.messages(connectionId, { peer }), messages);
  }
  // A cached conversation the snapshot doesn't mention has no messages.
  for (const query of qc
    .getQueryCache()
    .findAll({ queryKey: queryKeys.allMessages(connectionId) })) {
    if (!seeded.has(JSON.stringify(query.queryKey))) {
      qc.setQueryData<ConversationData>(query.queryKey, { messages: [], cursor: null });
    }
  }

  const store = useLiveStore.getState();
  if (store.connectionId === connectionId) {
    store.setNodeState(snapshot.state);
    store.setMyNodeNum(snapshot.myNodeNum);
  }

  // A later snapshot means the socket reconnected and events may have been missed:
  // reload the dashboard. The first one arrives with the page, which just loaded it.
  if (seenSnapshot.has(qc)) {
    for (const queryKey of [
      queryKeys.dashboard(connectionId),
      queryKeys.activity(connectionId),
      queryKeys.mapNodes(connectionId),
      queryKeys.conversations(connectionId),
      queryKeys.allNodeDetails(connectionId),
    ]) {
      void qc.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }
  seenSnapshot.add(qc);
}

const seenSnapshot = new WeakSet<QueryClient>();

/** Feed events kept in the cache; older ones are reloaded on demand. */
export const ACTIVITY_CACHE_LIMIT = 200;

/** Patches the cached dashboard of a connection, if one is cached. */
function patchDashboard(
  qc: QueryClient,
  connectionId: number,
  patch: (data: DashboardDTO) => DashboardDTO,
): void {
  qc.setQueryData<DashboardDTO>(queryKeys.dashboard(connectionId), (data) =>
    data ? patch(data) : data,
  );
}

/** Patches the cached map data of a connection, if loaded. */
function patchMap(
  qc: QueryClient,
  connectionId: number,
  patch: (data: MapNodesDTO) => MapNodesDTO,
): void {
  qc.setQueryData<MapNodesDTO>(queryKeys.mapNodes(connectionId), (data) =>
    data ? patch(data) : data,
  );
}

/** Patches the cached detail of one node (the drawer), if loaded. */
function patchDetail(
  qc: QueryClient,
  connectionId: number,
  num: number,
  patch: (data: NodeDetailDTO) => NodeDetailDTO,
): void {
  qc.setQueryData<NodeDetailDTO>(queryKeys.nodeDetail(connectionId, num), (data) =>
    data ? patch(data) : data,
  );
}

/** Applies one validated server message to the cache and store. */
export function applyServerMessage(
  qc: QueryClient,
  message: ServerMessage,
  now: number = Date.now(),
): void {
  switch (message.type) {
    case "snapshot":
      applySnapshot(qc, message);
      return;

    case "node.upsert": {
      const { node } = message;
      qc.setQueryData<MeshNode[]>(queryKeys.nodes(node.connectionId), (nodes) => {
        if (!nodes) return nodes;
        const i = nodes.findIndex((n) => n.num === node.num);
        if (i < 0) return [...nodes, node];
        const next = [...nodes];
        next[i] = node;
        return next;
      });
      patchDashboard(qc, node.connectionId, (d) => applyNodeUpsert(d, node));
      patchMap(qc, node.connectionId, (d) => applyNodeToMap(d, node));
      patchDetail(qc, node.connectionId, node.num, (d) => applyNodeToDetail(d, node));
      return;
    }

    case "message.new": {
      const m = message.message;
      // Not cached yet: the conversation's first fetch will include it.
      qc.setQueryData<ConversationData>(
        queryKeys.messages(m.connectionId, conversationOf(m)),
        (data) => {
          if (!data) return data;
          const messages = insertMessage(data.messages, m);
          return messages === data.messages ? data : { ...data, messages };
        },
      );
      patchDashboard(qc, m.connectionId, (d) => applyMessage(d, m));
      const nodes = qc.getQueryData<MeshNode[]>(queryKeys.nodes(m.connectionId)) ?? [];
      const ignored = new Set(nodes.filter((n) => n.isIgnored).map((n) => n.num));
      qc.setQueryData<ConversationsDTO>(queryKeys.conversations(m.connectionId), (d) =>
        d ? applyMessageToConversations(d, m, ignored, message.notify) : d,
      );
      handleMessageNew(qc, m, message.notify);
      return;
    }

    case "notifications.backlog": {
      handleBacklog(qc, message);
      return;
    }

    case "notification-prefs.updated": {
      qc.setQueryData(queryKeys.notificationPrefs, message.prefs);
      return;
    }

    case "conversation.read": {
      const { connectionId, kind, key, lastReadRxTime } = message;
      markConversationRead({ connectionId, kind, key });
      const result = { stale: false };
      qc.setQueryData<ConversationsDTO>(queryKeys.conversations(connectionId), (d) => {
        if (!d) return d;
        const next = applyReadToConversations(d, kind, key, lastReadRxTime);
        result.stale = next.stale;
        return next.data;
      });
      // Read only part of the way: the server has the exact count.
      if (result.stale)
        void qc.invalidateQueries({ queryKey: queryKeys.conversations(connectionId) });
      return;
    }

    case "conversation.updated": {
      const { connectionId, kind, key, state } = message;
      qc.setQueryData<ConversationsDTO>(queryKeys.conversations(connectionId), (d) =>
        d ? applyStateToConversations(d, kind, key, state) : d,
      );
      if (kind === "dm") {
        // A delete hides history: re-read the list and the thread.
        void qc.invalidateQueries({ queryKey: queryKeys.conversations(connectionId) });
        void qc.invalidateQueries({ queryKey: queryKeys.messages(connectionId, { peer: key }) });
      }
      return;
    }

    case "message.status": {
      const { connectionId, messageId, status, errorReason, relayed } = message;
      qc.setQueriesData<ConversationData>(
        { queryKey: queryKeys.allMessages(connectionId) },
        (data) => {
          if (!data) return data;
          const i = data.messages.findIndex((m) => m.id === messageId);
          const current = data.messages[i];
          if (
            !current ||
            (current.status === status &&
              current.errorReason === errorReason &&
              current.relayed === relayed)
          )
            return data;
          const messages = [...data.messages];
          messages[i] = { ...current, status, errorReason, relayed };
          return { ...data, messages };
        },
      );
      qc.setQueryData<ConversationsDTO>(queryKeys.conversations(connectionId), (d) =>
        d ? applyStatusToConversations(d, messageId, status) : d,
      );
      return;
    }

    case "connection.state": {
      const store = useLiveStore.getState();
      if (store.connectionId === message.connectionId) store.setNodeState(message.state);
      patchDashboard(qc, message.connectionId, (d) => applyConnectionState(d, message.state, now));
      return;
    }

    case "telemetry.new": {
      const { telemetry } = message;
      patchDashboard(qc, telemetry.connectionId, (d) => applyTelemetry(d, telemetry));
      patchMap(qc, telemetry.connectionId, (d) => applyTelemetryToMap(d, telemetry));
      patchDetail(qc, telemetry.connectionId, telemetry.nodeNum, (d) =>
        applyTelemetryToDetail(d, telemetry),
      );
      // Open charts on a sliding range (not a custom one) take the sample in place.
      qc.setQueriesData<SeriesDTO>(
        {
          queryKey: queryKeys.seriesOf(telemetry.connectionId, telemetry.nodeNum, telemetry.kind),
          predicate: (q) => !String(q.queryKey[4]).startsWith("custom:"),
        },
        (d) => (d ? applyReportToSeries(d, telemetry) : d),
      );
      return;
    }

    case "position.new": {
      const { position } = message;
      patchDashboard(qc, position.connectionId, (d) => applyPosition(d, position));
      patchMap(qc, position.connectionId, (d) =>
        applyPositionToMap(d, position, useLiveStore.getState().myNodeNum),
      );
      patchDetail(qc, position.connectionId, position.nodeNum, (d) =>
        applyPositionToDetail(d, position),
      );
      return;
    }

    case "config.updated": {
      // The editor re-reads; pending edits whose base changed become conflicts.
      void qc.invalidateQueries({ queryKey: queryKeys.deviceConfig(message.connectionId) });
      return;
    }

    case "config.apply": {
      qc.setQueryData(queryKeys.configApply(message.status.connectionId), message.status);
      return;
    }

    case "activity.new": {
      const { activity } = message;
      qc.setQueryData<ActivityPage>(queryKeys.activity(activity.connectionId), (data) => {
        if (!data || data.events.some((e) => e.id === activity.id)) return data;
        // Newest first; keep the cached list bounded.
        const all = [activity, ...data.events];
        if (all.length <= ACTIVITY_CACHE_LIMIT) return { ...data, events: all };
        const events = all.slice(0, ACTIVITY_CACHE_LIMIT);
        // Dropped the oldest: "load older" continues from what's kept.
        return { events, nextBefore: events.at(-1)?.id ?? null };
      });
      return;
    }

    case "error":
      console.warn("MeshTerm server error:", message.code, message.message);
      return;
  }
}
