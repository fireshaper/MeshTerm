import { fixtures, type Message } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import { Hub } from "../events/events.js";
import { BACKLOG_AGE_MS, BACKLOG_WINDOW_MS, BacklogTracker } from "./backlog.js";

let hub: Hub;
let clock: FakeClock;
let tracker: BacklogTracker;
const summaries: unknown[] = [];

const state = (s: "connected" | "reconnecting", previous: string | null) => {
  hub.publish("connection.state", {
    connectionId: 1,
    state: s,
    previous: previous as never,
    reason: null,
  });
};

beforeEach(() => {
  hub = new Hub();
  clock = new FakeClock();
  tracker = new BacklogTracker(hub, clock);
  summaries.length = 0;
  hub.subscribe("notifications.backlog", (p) => summaries.push(p));
});
afterEach(() => {
  tracker.close();
});

const msg = (over: Partial<Message>): Message => ({ ...fixtures.inboundMessage, ...over });

describe("BacklogTracker", () => {
  it("in the window after a handshake, old messages are backlog; fresh ones aren't", () => {
    state("connected", "configuring");
    const now = clock.now();
    expect(tracker.isBacklog(1, now - BACKLOG_AGE_MS - 1)).toBe(true);
    expect(tracker.isBacklog(1, now - 5_000)).toBe(false);
    clock.advance(BACKLOG_WINDOW_MS);
    expect(tracker.isBacklog(1, clock.now() - BACKLOG_AGE_MS - 1)).toBe(false);
  });

  it("messages received while the link was down are backlog, whenever they arrive", () => {
    state("connected", "configuring");
    clock.advance(BACKLOG_WINDOW_MS + 1);
    state("reconnecting", "connected");
    const down = clock.now();
    // Back half a second into a whole second.
    clock.advance(120_500);
    state("connected", "configuring");
    clock.advance(BACKLOG_WINDOW_MS + 5_000);
    expect(tracker.isBacklog(1, down + 10_000)).toBe(true);
    expect(tracker.isBacklog(1, down - 10_000)).toBe(false);
    // Heard in the second the link came back (rx_time is whole seconds): live, not backlog.
    const back = down + 120_500;
    expect(tracker.isBacklog(1, Math.floor(back / 1000) * 1000)).toBe(false);
    // Unknown connection, or never connected: never backlog.
    expect(tracker.isBacklog(2, 0)).toBe(false);
  });

  it("publishes one summary when the window closes, and none for an empty window", () => {
    state("connected", "configuring");
    tracker.record(msg({ peer: 0x0badcafe }));
    tracker.record(msg({ peer: 0x0badcafe, id: "x" }));
    tracker.record(msg({ peer: null, channelIndex: 1 }));
    tracker.record(msg({ peer: null, emoji: true }));
    tracker.record({ ...fixtures.outboundMessage });
    clock.advance(BACKLOG_WINDOW_MS);
    expect(summaries).toEqual([
      {
        connectionId: 1,
        count: 3,
        dmCount: 2,
        conversations: [
          { kind: "dm", key: 0x0badcafe, count: 2 },
          { kind: "channel", key: 1, count: 1 },
        ],
      },
    ]);
    state("reconnecting", "connected");
    state("connected", "configuring");
    clock.advance(BACKLOG_WINDOW_MS);
    expect(summaries).toHaveLength(1);
  });
});
