import { ServerMessage } from "@meshterm/shared";
import type { SocketStatus } from "./store.js";

export interface LiveSocketOptions {
  url: string;
  connectionId: number;
  onMessage: (message: ServerMessage) => void;
  onStatus?: (status: SocketStatus) => void;
  /** Called for a frame that isn't valid JSON or doesn't match the protocol. Default: console.warn. */
  onInvalid?: (raw: unknown, problem: string) => void;
  backoff?: { minMs: number; maxMs: number };
  /** Injectable for tests; defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
}

/** `ws(s)://<this host>/ws`. */
export function liveSocketUrl(location: Location = window.location): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

/**
 * The browser's live link to the server. Subscribes on every (re)connect, so each
 * new connection starts with a fresh snapshot, and retries forever with backoff.
 */
export class LiveSocket {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = true;

  constructor(private readonly options: LiveSocketOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.options.onStatus?.("closed");
  }

  private connect(): void {
    const { url, connectionId, WebSocketImpl = WebSocket } = this.options;
    this.options.onStatus?.("connecting");
    const socket = new WebSocketImpl(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.failures = 0;
      this.options.onStatus?.("open");
      socket.send(JSON.stringify({ type: "subscribe", connectionId }));
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (this.socket === socket) this.receive(event.data);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.stopped) this.scheduleReconnect();
    });
    // An error is always followed by close, which handles it.
  }

  private receive(data: unknown): void {
    const report = this.options.onInvalid ?? defaultOnInvalid;
    if (typeof data !== "string") {
      report(data, "binary frame");
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      report(data, "not JSON");
      return;
    }
    const parsed = ServerMessage.safeParse(json);
    if (!parsed.success) {
      report(json, parsed.error.message);
      return;
    }
    this.options.onMessage(parsed.data);
  }

  private scheduleReconnect(): void {
    const { minMs, maxMs } = this.options.backoff ?? { minMs: 500, maxMs: 10_000 };
    const delay = Math.min(maxMs, minMs * 2 ** Math.min(this.failures, 20));
    this.failures++;
    this.options.onStatus?.("closed");
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }
}

function defaultOnInvalid(raw: unknown, problem: string): void {
  console.warn("MeshTerm: dropped an invalid server frame:", problem, raw);
}
