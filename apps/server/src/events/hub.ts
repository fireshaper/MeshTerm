import { silentLogger, type Logger } from "../logger.js";

type Handler<P> = (payload: P) => void;

/**
 * In-process publish/subscribe with typed events. Delivery is synchronous and in
 * subscription order. A handler that throws is logged and the rest still run.
 */
export class EventHub<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();
  private readonly anyHandlers = new Set<Handler<AnyEvent<Events>>>();

  constructor(private readonly logger: Logger = silentLogger) {}

  /** Returns a function that unsubscribes. */
  subscribe<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const stored = handler as Handler<never>;
    set.add(stored);
    return () => {
      set.delete(stored);
    };
  }

  /** Receives every event as `{ type, payload }`. Returns a function that unsubscribes. */
  subscribeAll(handler: Handler<AnyEvent<Events>>): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  publish<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    for (const handler of set ? [...set] : []) {
      this.deliver(type, () => {
        (handler as Handler<Events[K]>)(payload);
      });
    }
    const event: AnyEvent<Events> = { type, payload };
    for (const handler of [...this.anyHandlers]) {
      this.deliver(type, () => {
        handler(event);
      });
    }
  }

  private deliver(type: keyof Events, run: () => void): void {
    try {
      run();
    } catch (err) {
      this.logger.error({ err, event: String(type) }, "event subscriber threw");
    }
  }
}

export type AnyEvent<Events extends object> = {
  [K in keyof Events]: { type: K; payload: Events[K] };
}[keyof Events];
