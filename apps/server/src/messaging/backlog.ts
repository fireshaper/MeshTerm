import type { Message } from "@meshterm/shared";
import type { Clock } from "../clock.js";
import type { Hub } from "../events/events.js";

/** After a handshake, messages arriving this long count as the reconnect burst. */
export const BACKLOG_WINDOW_MS = 30_000;
/** …when they were received this much earlier than they reached us. */
export const BACKLOG_AGE_MS = 60_000;
/** `rx_time` has whole seconds: a message heard in the second of the handshake isn't "while down". */
const RX_RESOLUTION_MS = 1_000;

interface ConnectionTimes {
  /** When the current link completed its handshake. */
  connectedAt: number | null;
  /** When the previous link dropped (null before the first drop). */
  downSince: number | null;
  /** Backlog messages counted in the current window. */
  window: Map<string, { kind: "channel" | "dm"; key: number; count: number }>;
  cancel: (() => void) | null;
}

/**
 * Classifies inbound messages as backlog (CR-003 §4.3) and, once the window after each
 * handshake closes, publishes one `notifications.backlog` summary. Follows the links
 * through `connection.state` events.
 */
export class BacklogTracker {
  private readonly times = new Map<number, ConnectionTimes>();
  private readonly off: () => void;

  constructor(
    private readonly hub: Hub,
    private readonly clock: Clock,
  ) {
    this.off = hub.subscribe("connection.state", ({ connectionId, state, previous }) => {
      const t = this.entry(connectionId);
      const now = this.clock.now();
      if (state === "connected") {
        t.connectedAt = now;
        t.window.clear();
        t.cancel?.();
        t.cancel = this.clock.setTimer(BACKLOG_WINDOW_MS, () => {
          t.cancel = null;
          this.summarize(connectionId, t);
        });
      } else if (previous === "connected") {
        t.downSince = now;
        t.connectedAt = null;
      }
    });
  }

  close(): void {
    this.off();
    for (const t of this.times.values()) t.cancel?.();
  }

  /**
   * Backlog: in the window after a handshake and received over a minute before it
   * reached us, or received while MeshTerm's link was down.
   */
  isBacklog(connectionId: number, rxTime: number): boolean {
    const t = this.times.get(connectionId);
    if (!t?.connectedAt) return false;
    const now = this.clock.now();
    const inWindow = now - t.connectedAt < BACKLOG_WINDOW_MS && now - rxTime > BACKLOG_AGE_MS;
    const whileDown =
      t.downSince !== null && rxTime >= t.downSince && rxTime + RX_RESOLUTION_MS <= t.connectedAt;
    return inWindow || whileDown;
  }

  /** Counts a stored backlog message toward this window's summary. */
  record(message: Message): void {
    if (message.direction !== "in" || message.emoji) return;
    const t = this.times.get(message.connectionId);
    if (!t) return;
    const kind = message.peer === null ? "channel" : "dm";
    const key = message.peer ?? message.channelIndex;
    const id = `${kind}:${key}`;
    const row = t.window.get(id) ?? { kind, key, count: 0 };
    row.count += 1;
    t.window.set(id, row);
  }

  private summarize(connectionId: number, t: ConnectionTimes): void {
    const conversations = [...t.window.values()];
    t.window.clear();
    if (conversations.length === 0) return;
    this.hub.publish("notifications.backlog", {
      connectionId,
      count: conversations.reduce((n, c) => n + c.count, 0),
      dmCount: conversations.filter((c) => c.kind === "dm").reduce((n, c) => n + c.count, 0),
      conversations,
    });
  }

  private entry(connectionId: number): ConnectionTimes {
    let t = this.times.get(connectionId);
    if (!t) {
      t = { connectedAt: null, downSince: null, window: new Map(), cancel: null };
      this.times.set(connectionId, t);
    }
    return t;
  }
}
