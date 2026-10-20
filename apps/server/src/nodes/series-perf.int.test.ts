// CR-001 §6.2/§9: a 30-day series for one node in < 100 ms, with 300 nodes × 30 days
// of device telemetry every 15 min (864 000 rows) in the table.
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../db/database.js";
import { openTestDatabase } from "../db/test-db.js";
import { signalSeries, telemetrySeries } from "./series.js";

const NODES = 300;
const DAYS = 30;
const STEP = 15 * 60_000;
const DAY = 24 * 3600_000;
const NOW = 1_800_000_000_000;

let handle: DatabaseHandle;

beforeAll(() => {
  handle = openTestDatabase();
  const { sqlite } = handle;
  const insert = sqlite.prepare(
    `INSERT INTO telemetry (connection_id, node_num, kind, time, battery_level, voltage,
       channel_util, air_util_tx, uptime_seconds, metrics)
     VALUES (1, ?, 'device', ?, ?, ?, ?, ?, ?, ?)`,
  );
  const signal = sqlite.prepare(
    "INSERT INTO signal_log (connection_id, node_num, time, snr, rssi, hops) VALUES (1, ?, ?, ?, ?, 0)",
  );
  sqlite.transaction(() => {
    for (let n = 1; n <= NODES; n++) {
      for (let t = NOW - DAYS * DAY; t < NOW; t += STEP) {
        const battery = 50 + ((t / STEP + n) % 50);
        const metrics = JSON.stringify({
          battery_level: battery,
          voltage: 3.9,
          channel_utilization: 12.5,
          air_util_tx: 1.5,
          uptime_seconds: (t - NOW + DAYS * DAY) / 1000,
        });
        insert.run(n, t, battery, 3.9, 12.5, 1.5, (t - NOW + DAYS * DAY) / 1000, metrics);
        if (n <= 20 && t > NOW - 7 * DAY) signal.run(n, t, 5.5, -90);
      }
    }
  })();
}, 120_000);

afterAll(() => {
  handle.close();
});

/** Best of a few runs (the first warms SQLite's page cache). */
function timed(fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("series performance", () => {
  it(`30 d of one node among ${NODES} answers in < 100 ms`, () => {
    const query = { from: NOW - DAYS * DAY, to: NOW };
    const result = telemetrySeries(handle.db, 1, 150, "device", query);
    expect(result.t.length).toBeLessThanOrEqual(1_000);
    expect(Object.keys(result.series)).toContain("battery_level");
    const ms = timed(() => telemetrySeries(handle.db, 1, 150, "device", query));
    expect(ms).toBeLessThan(100);
  });

  it("7 d of signal answers in < 100 ms", () => {
    const ms = timed(() => signalSeries(handle.db, 1, 10, { from: NOW - 7 * DAY, to: NOW }));
    expect(ms).toBeLessThan(100);
  });
});
