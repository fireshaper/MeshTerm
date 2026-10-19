import { EventEmitter } from "node:events";
import type { ConnectionState } from "@meshterm/shared";

export interface StateChange {
  previous: ConnectionState;
  state: ConnectionState;
  reason: string;
}

/**
 * Every allowed transition. Active states fall to `reconnecting` on failure, and
 * every state except `disconnected` itself may be stopped.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  disconnected: ["connecting"],
  connecting: ["configuring", "reconnecting", "disconnected"],
  configuring: ["connected", "reconnecting", "disconnected"],
  connected: ["reconnecting", "disconnected"],
  reconnecting: ["connecting", "disconnected"],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: ConnectionState,
    readonly to: ConnectionState,
  ) {
    super(`illegal connection state transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/** Holds a connection's state and emits exactly one `change` per transition. */
export class ConnectionStateMachine extends EventEmitter<{ change: [StateChange] }> {
  private current: ConnectionState = "disconnected";

  get state(): ConnectionState {
    return this.current;
  }

  /** Moves to `to` or throws {@link IllegalTransitionError}. */
  transition(to: ConnectionState, reason: string): void {
    const previous = this.current;
    if (!ALLOWED_TRANSITIONS[previous].includes(to)) throw new IllegalTransitionError(previous, to);
    this.current = to;
    this.emit("change", { previous, state: to, reason });
  }
}
