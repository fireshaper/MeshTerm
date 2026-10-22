/**
 * One tab alerts (CR-003 §9): when several MeshTerm tabs are open in this browser,
 * only the "leader" plays sounds, flashes its title and shows OS notifications. Tabs
 * announce themselves on a BroadcastChannel; the focused tab leads, else the one
 * focused most recently. Every tab still updates its own title, badges and toasts.
 */

export interface TabInfo {
  id: string;
  focused: boolean;
  /** When the tab last had focus (epoch ms; 0: never). */
  lastFocusedAt: number;
  /** When it last announced itself. */
  seenAt: number;
}

export const CHANNEL_NAME = "meshterm-notify";
export const HEARTBEAT_MS = 1_000;
/** A tab not heard from for this long is gone (closed, or its timers frozen). */
export const STALE_MS = 3_500;

/** The leading tab's id among those still alive. Ties go to the smallest id. */
export function electLeader(tabs: readonly TabInfo[], now: number): string | null {
  const alive = tabs.filter((t) => now - t.seenAt < STALE_MS);
  if (alive.length === 0) return null;
  const sorted = [...alive].sort(
    (a, b) =>
      Number(b.focused) - Number(a.focused) ||
      b.lastFocusedAt - a.lastFocusedAt ||
      a.id.localeCompare(b.id),
  );
  return sorted[0]?.id ?? null;
}

type Message = Omit<TabInfo, "seenAt"> & { type: "hello" | "bye" };

export interface LeaderOptions {
  now?: () => number;
  focused?: () => boolean;
  channel?: BroadcastChannel | null;
}

/**
 * This tab's view of the election. Without BroadcastChannel (old browsers, tests) the
 * tab is always the leader.
 */
export class TabLeader {
  readonly id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  private readonly peers = new Map<string, TabInfo>();
  private readonly channel: BroadcastChannel | null;
  private readonly now: () => number;
  private readonly focused: () => boolean;
  private lastFocusedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LeaderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.focused = options.focused ?? (() => document.hasFocus());
    this.channel =
      options.channel !== undefined
        ? options.channel
        : typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel(CHANNEL_NAME);
    if (this.channel) {
      this.channel.onmessage = (e: MessageEvent<Message>) => {
        this.receive(e.data);
      };
    }
  }

  start(): void {
    if (this.timer || !this.channel) return;
    this.announce();
    this.timer = setInterval(() => {
      this.announce();
    }, HEARTBEAT_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.post("bye");
    this.channel?.close();
  }

  /** Call when focus changes, so the new focused tab leads at once. */
  announce(): void {
    if (this.focused()) this.lastFocusedAt = this.now();
    this.post("hello");
  }

  get isLeader(): boolean {
    if (!this.channel) return true;
    const now = this.now();
    const self: TabInfo = {
      id: this.id,
      focused: this.focused(),
      lastFocusedAt: this.focused() ? now : this.lastFocusedAt,
      seenAt: now,
    };
    return electLeader([self, ...this.peers.values()], now) === this.id;
  }

  receive(message: Message): void {
    if (message.id === this.id) return;
    if (message.type === "bye") {
      this.peers.delete(message.id);
      return;
    }
    this.peers.set(message.id, {
      id: message.id,
      focused: message.focused,
      lastFocusedAt: message.lastFocusedAt,
      seenAt: this.now(),
    });
  }

  private post(type: Message["type"]): void {
    try {
      this.channel?.postMessage({
        type,
        id: this.id,
        focused: this.focused(),
        lastFocusedAt: this.lastFocusedAt,
      } satisfies Message);
    } catch {
      // A closed channel: nothing to tell.
    }
  }
}
