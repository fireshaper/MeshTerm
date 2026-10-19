/** Time source and timers, injectable so tests can drive them by hand. */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** Runs `fn` after `ms`. Returns a function that cancels it. */
  setTimer(ms: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer(ms, fn) {
    const timer = setTimeout(fn, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

/** Random source in [0, 1), injectable for deterministic tests. */
export type Random = () => number;

interface PendingTimer {
  due: number;
  seq: number;
  fn: () => void;
}

/** A clock that only moves when `advance()` is called. Timers fire in due order. */
export class FakeClock implements Clock {
  private time: number;
  private seq = 0;
  private timers: PendingTimer[] = [];

  constructor(start = 1_800_000_000_000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimer(ms: number, fn: () => void): () => void {
    const timer: PendingTimer = { due: this.time + Math.max(0, ms), seq: this.seq++, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  /** Delays (from now) of the timers still pending, soonest first. */
  pendingDelays(): number[] {
    return this.sorted().map((t) => t.due - this.time);
  }

  /** Moves time forward by `ms`, firing every timer that falls due on the way. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = this.sorted()[0];
      if (!next || next.due > target) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.time = next.due;
      next.fn();
    }
    this.time = target;
  }

  private sorted(): PendingTimer[] {
    return [...this.timers].sort((a, b) => a.due - b.due || a.seq - b.seq);
  }
}
