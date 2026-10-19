import type { ConnectionState } from "@meshterm/shared";
import { useLiveStore, type SocketStatus } from "../data/store.js";

export type PillState = ConnectionState | "unknown";

/** Text for each state, so the pill never relies on color alone. */
export const PILL_LABELS: Record<PillState, string> = {
  connected: "Connected",
  configuring: "Configuring",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
  unknown: "Unknown",
};

const SOCKET_LABELS: Record<Exclude<SocketStatus, "open">, string> = {
  connecting: "Connecting to server…",
  closed: "Server offline",
};

/**
 * The node's connection state (`data-mt-state` = the state name), plus a separate
 * indicator while the browser's own link to the server is down, since the node
 * state shown is then stale.
 */
export function StatusPill() {
  const nodeState = useLiveStore((s) => s.nodeState);
  const socketStatus = useLiveStore((s) => s.socketStatus);
  const state: PillState = nodeState ?? "unknown";
  return (
    <span data-mt="status-area">
      <span
        data-mt="status-pill"
        data-mt-state={state}
        role="status"
        aria-label={`Node: ${PILL_LABELS[state]}`}
      >
        <span data-mt="status-dot" aria-hidden="true" />
        <span data-mt="status-label">{PILL_LABELS[state]}</span>
      </span>
      {socketStatus !== "open" && (
        <span data-mt="socket-indicator" data-mt-state={socketStatus} role="alert">
          {SOCKET_LABELS[socketStatus]}
        </span>
      )}
    </span>
  );
}
