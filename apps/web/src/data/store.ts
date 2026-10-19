import type { ConnectionState } from "@meshterm/shared";
import { create } from "zustand";

/** The browser's own WebSocket to the server, separate from the node connection. */
export type SocketStatus = "connecting" | "open" | "closed";

export interface LiveState {
  socketStatus: SocketStatus;
  /** The connection the UI shows and subscribes to; null until connections load. */
  connectionId: number | null;
  /** The server's node connection state for `connectionId`; null before the first snapshot. */
  nodeState: ConnectionState | null;
  myNodeNum: number | null;
  setSocketStatus: (status: SocketStatus) => void;
  setConnectionId: (id: number | null) => void;
  setNodeState: (state: ConnectionState) => void;
  setMyNodeNum: (num: number | null) => void;
}

const initial = {
  socketStatus: "connecting" as SocketStatus,
  connectionId: null,
  nodeState: null,
  myNodeNum: null,
};

export const useLiveStore = create<LiveState>()((set) => ({
  ...initial,
  setSocketStatus: (socketStatus) => {
    set({ socketStatus });
  },
  setConnectionId: (connectionId) => {
    set({ connectionId });
  },
  setNodeState: (nodeState) => {
    set({ nodeState });
  },
  setMyNodeNum: (myNodeNum) => {
    set({ myNodeNum });
  },
}));

/** Back to the initial state; for tests. */
export function resetLiveStore(): void {
  useLiveStore.setState(initial);
}
