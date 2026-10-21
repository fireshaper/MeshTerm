import type { EventEmitter } from "node:events";
import type { FromRadio, ToRadioInit } from "@meshterm/protocol";

/** Why a link ended without `disconnect()` being called. */
export type CloseReason = "peer-closed" | "error";

export interface TransportClose {
  reason: CloseReason;
  /** The error that ended the link, when there was one. */
  error: Error | null;
}

export interface TransportEvents {
  open: [];
  fromRadio: [message: FromRadio];
  close: [info: TransportClose];
  /** Informational; a fatal error is always followed by `close`. */
  error: [error: Error];
}

/**
 * A byte link to one node that speaks `ToRadio` out and `FromRadio` in. It knows
 * nothing about the handshake or the mesh: that is `NodeConnection`'s job.
 *
 * Contract (checked by `describeTransportContract`):
 * - Single use. `connect()` is called at most once; reconnecting means a new instance.
 * - `connect()` resolves after emitting `open`. If it fails it rejects and emits nothing.
 * - Each decoded frame emits `fromRadio`. A frame that fails to decode emits `error`
 *   and the link stays up.
 * - If the link ends without `disconnect()`, `close` is emitted exactly once.
 * - `disconnect()` is idempotent, safe before `connect()`, resolves once the link is
 *   down, and nothing is emitted after it is called.
 * - `send()` throws unless the link is open.
 */
export interface Transport extends EventEmitter<TransportEvents> {
  readonly isOpen: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: ToRadioInit): void;
}

/** Makes a transport for one attempt; `host` overrides the connection's host (address change). */
export type TransportFactory = (host?: string) => Transport;
