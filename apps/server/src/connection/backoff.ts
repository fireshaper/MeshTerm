import type { Random } from "../clock.js";

export interface BackoffOptions {
  minMs: number;
  maxMs: number;
  /** Fraction of the delay to randomize by, in both directions. 0.2 means ±20 %. */
  jitter: number;
}

export const DEFAULT_JITTER = 0.2;

/**
 * Delay before retry number `failures` (0 for the first retry): `minMs * 2^failures`,
 * jittered by ±`jitter`, never above `maxMs`. A random value of 0.5 gives the
 * un-jittered delay.
 */
export function backoffDelay(failures: number, options: BackoffOptions, random: Random): number {
  const { minMs, maxMs, jitter } = options;
  const base = Math.min(maxMs, minMs * 2 ** Math.min(failures, 30));
  const jittered = base * (1 + jitter * (2 * random() - 1));
  return Math.round(Math.min(maxMs, jittered));
}
