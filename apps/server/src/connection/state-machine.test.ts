import { ConnectionState } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  ConnectionStateMachine,
  IllegalTransitionError,
  type StateChange,
} from "./state-machine.js";

/** Shortest path from `disconnected` to each state, through allowed transitions. */
const PATH_TO: Record<ConnectionState, ConnectionState[]> = {
  disconnected: [],
  connecting: ["connecting"],
  configuring: ["connecting", "configuring"],
  connected: ["connecting", "configuring", "connected"],
  reconnecting: ["connecting", "reconnecting"],
};

function machineIn(state: ConnectionState): {
  machine: ConnectionStateMachine;
  events: StateChange[];
} {
  const machine = new ConnectionStateMachine();
  for (const step of PATH_TO[state]) machine.transition(step, "setup");
  const events: StateChange[] = [];
  machine.on("change", (e) => events.push(e));
  return { machine, events };
}

const allowed = ConnectionState.options.flatMap((from) =>
  ALLOWED_TRANSITIONS[from].map((to) => ({ from, to })),
);
const forbidden = ConnectionState.options.flatMap((from) =>
  ConnectionState.options
    .filter((to) => !ALLOWED_TRANSITIONS[from].includes(to))
    .map((to) => ({ from, to })),
);

describe("ConnectionStateMachine", () => {
  it("starts disconnected", () => {
    expect(new ConnectionStateMachine().state).toBe("disconnected");
  });

  it("matches the transitions in the plan", () => {
    expect(allowed).toEqual(
      expect.arrayContaining([
        { from: "disconnected", to: "connecting" },
        { from: "connecting", to: "configuring" },
        { from: "configuring", to: "connected" },
        { from: "connecting", to: "reconnecting" },
        { from: "configuring", to: "reconnecting" },
        { from: "connected", to: "reconnecting" },
        { from: "reconnecting", to: "connecting" },
        { from: "connecting", to: "disconnected" },
        { from: "configuring", to: "disconnected" },
        { from: "connected", to: "disconnected" },
        { from: "reconnecting", to: "disconnected" },
      ]),
    );
    expect(allowed).toHaveLength(11);
  });

  it.each(allowed)("allows $from → $to with exactly one event", ({ from, to }) => {
    const { machine, events } = machineIn(from);
    machine.transition(to, "because");
    expect(machine.state).toBe(to);
    expect(events).toEqual([{ previous: from, state: to, reason: "because" }]);
  });

  it.each(forbidden)("rejects $from → $to without an event", ({ from, to }) => {
    const { machine, events } = machineIn(from);
    expect(() => {
      machine.transition(to, "nope");
    }).toThrow(IllegalTransitionError);
    expect(machine.state).toBe(from);
    expect(events).toEqual([]);
  });
});
