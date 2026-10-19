import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { applyServerMessage } from "./apply.js";
import { LiveSocket, liveSocketUrl } from "./live-socket.js";
import { useConnections } from "./queries.js";
import { useLiveStore } from "./store.js";

/**
 * Picks the connection to show (the first enabled one, for now) and keeps a live
 * socket subscribed to it, feeding every frame into the query cache and store.
 */
export function LiveConnection() {
  const qc = useQueryClient();
  const { data: connections } = useConnections();
  const connectionId = useLiveStore((s) => s.connectionId);

  useEffect(() => {
    if (connectionId !== null || !connections) return;
    const first = connections.find((c) => c.enabled);
    if (!first) return;
    const store = useLiveStore.getState();
    store.setConnectionId(first.id);
    if (first.state) store.setNodeState(first.state);
    store.setMyNodeNum(first.myNodeNum);
  }, [connections, connectionId]);

  useEffect(() => {
    if (connectionId === null) return;
    const socket = new LiveSocket({
      url: liveSocketUrl(),
      connectionId,
      onMessage: (message) => {
        applyServerMessage(qc, message);
      },
      onStatus: (status) => {
        useLiveStore.getState().setSocketStatus(status);
      },
    });
    socket.start();
    return () => {
      socket.stop();
    };
  }, [connectionId, qc]);

  return null;
}
