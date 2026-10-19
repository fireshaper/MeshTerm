import { fixtures } from "@meshterm/shared";
import type { Connection } from "@meshterm/shared";
import type { RetryScheduled, NodeConnection } from "./node-connection.js";
import type { StateChange } from "./state-machine.js";

export const TEST_CONNECTION: Connection = fixtures.connection;

/** Records a NodeConnection's state changes and scheduled retries as they happen. */
export function recordConnection(conn: NodeConnection): {
  states: StateChange[];
  retries: RetryScheduled[];
  stateNames: () => string[];
} {
  const states: StateChange[] = [];
  const retries: RetryScheduled[] = [];
  conn.on("state", (s) => states.push(s));
  conn.on("retry", (r) => retries.push(r));
  return { states, retries, stateNames: () => states.map((s) => s.state) };
}
