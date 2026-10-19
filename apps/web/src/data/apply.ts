import {
  messageCursor,
  SNAPSHOT_MESSAGES,
  type MeshNode,
  type Message,
  type ServerMessage,
  type ServerMessageOf,
} from "@meshterm/shared";
import type { QueryClient } from "@tanstack/react-query";
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
}

/** Applies one validated server message to the cache and store. */
export function applyServerMessage(qc: QueryClient, message: ServerMessage): void {
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
      return;
    }

    case "message.status": {
      const { connectionId, messageId, status } = message;
      qc.setQueriesData<ConversationData>(
        { queryKey: queryKeys.allMessages(connectionId) },
        (data) => {
          if (!data) return data;
          const i = data.messages.findIndex((m) => m.id === messageId);
          const current = data.messages[i];
          if (!current || current.status === status) return data;
          const messages = [...data.messages];
          messages[i] = { ...current, status };
          return { ...data, messages };
        },
      );
      return;
    }

    case "connection.state": {
      const store = useLiveStore.getState();
      if (store.connectionId === message.connectionId) store.setNodeState(message.state);
      return;
    }

    case "error":
      console.warn("MeshTerm server error:", message.code, message.message);
      return;
  }
}
