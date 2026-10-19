import { until } from "@meshterm/fake-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import { MockPeer } from "../transport/mock-transport.js";
import { backoffDelay } from "./backoff.js";
import { NodeConnection } from "./node-connection.js";
import { recordConnection, TEST_CONNECTION } from "./test-helpers.js";

const OPTS = { minMs: 2_000, maxMs: 60_000, jitter: 0.2 };

describe("backoffDelay", () => {
  it("doubles from 2 s and caps at 60 s with no jitter at random = 0.5", () => {
    const delays = Array.from({ length: 8 }, (_, i) => backoffDelay(i, OPTS, () => 0.5));
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it("jitters by ±20 % and never exceeds the cap", () => {
    expect(backoffDelay(0, OPTS, () => 0)).toBe(1_600);
    expect(backoffDelay(0, OPTS, () => 0.999_999)).toBe(2_400);
    expect(backoffDelay(10, OPTS, () => 0)).toBe(48_000);
    expect(backoffDelay(10, OPTS, () => 0.999_999)).toBe(60_000);
  });

  it("stays finite for very long outages", () => {
    expect(backoffDelay(10_000, OPTS, () => 0.5)).toBe(60_000);
  });
});

describe("NodeConnection reconnect", () => {
  let peer: MockPeer;
  let clock: FakeClock;
  let conn: NodeConnection;
  let attempts: number;
  let rec: ReturnType<typeof recordConnection>;

  beforeEach(() => {
    peer = new MockPeer();
    peer.reachable = false;
    // A well-behaved node: echo the nonce straight back.
    peer.onReceive = (message) => {
      const v = message.payloadVariant;
      if (v.case === "wantConfigId")
        peer.sendFromRadio({ case: "configCompleteId", value: v.value });
    };
    clock = new FakeClock();
    attempts = 0;
    conn = new NodeConnection({
      connection: TEST_CONNECTION,
      createTransport: () => {
        attempts++;
        return peer.createTransport();
      },
      timing: {
        configTimeoutMs: 30_000,
        heartbeatIntervalMs: 60_000,
        backoffMinMs: OPTS.minMs,
        backoffMaxMs: OPTS.maxMs,
      },
      clock,
      random: () => 0.5,
    });
    rec = recordConnection(conn);
  });

  afterEach(async () => {
    await conn.stop();
  });

  /** Waits for the n-th scheduled retry, then fires it. Returns its delay. */
  async function nextRetry(n: number): Promise<number> {
    await until(() => rec.retries.length >= n);
    const delay = rec.retries[n - 1]?.delayMs ?? -1;
    expect(clock.pendingDelays()).toEqual([delay]);
    clock.advance(delay);
    return delay;
  }

  it("follows 2, 4, 8, 16, 32 s then holds at 60 s", async () => {
    conn.start();
    const delays: number[] = [];
    for (let n = 1; n <= 8; n++) delays.push(await nextRetry(n));
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it("is still retrying after 25 consecutive failures", async () => {
    conn.start();
    for (let n = 1; n <= 25; n++) await nextRetry(n);
    await until(() => rec.retries.length === 26);
    expect(attempts).toBe(26);
    expect(conn.state).toBe("reconnecting");
    expect(rec.retries.at(-1)).toEqual({ failures: 26, delayMs: 60_000 });
    expect(clock.pendingDelays()).toEqual([60_000]);
  });

  it("stop() during the wait cancels the retry", async () => {
    conn.start();
    await until(() => rec.retries.length === 1);
    await conn.stop();
    expect(conn.state).toBe("disconnected");
    expect(clock.pendingDelays()).toEqual([]);
    clock.advance(3_600_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(attempts).toBe(1);
    expect(conn.state).toBe("disconnected");
  });

  it("resets the delay to 2 s after a successful connection", async () => {
    conn.start();
    expect(await nextRetry(1)).toBe(2_000);
    expect(await nextRetry(2)).toBe(4_000);
    await until(() => rec.retries.length === 3);
    expect(rec.retries[2]?.delayMs).toBe(8_000);

    peer.reachable = true;
    clock.advance(8_000);
    await until(() => conn.state === "connected");

    peer.close();
    await until(() => rec.retries.length === 4);
    expect(rec.retries[3]).toEqual({ failures: 1, delayMs: 2_000 });
    expect(rec.states.at(-1)).toMatchObject({
      previous: "connected",
      state: "reconnecting",
      reason: "link closed (peer-closed)",
    });
  });
});
