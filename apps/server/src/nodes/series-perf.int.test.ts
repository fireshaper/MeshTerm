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
  // Generated inside SQLite in one statement each: much less CPU than 864 000 inserts
  // from JS, so the other timing tests running alongside aren't starved.
  const start = NOW - DAYS * DAY;
  handle.sqlite.exec(`
    WITH RECURSIVE
      n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${NODES}),
      t(ts) AS (SELECT ${start} UNION ALL SELECT ts + ${STEP} FROM t WHERE ts + ${STEP} < ${NOW})
    INSERT INTO telemetry (connection_id, node_num, kind, time, battery_level, voltage,
      channel_util, air_util_tx, uptime_seconds, metrics)
    SELECT 1, i, 'device', ts, 50 + ((ts / ${STEP} + i) % 50), 3.9, 12.5, 1.5,
      (ts - ${start}) / 1000,
      json_object('battery_level', 50 + ((ts / ${STEP} + i) % 50), 'voltage', 3.9,
        'channel_utilization', 12.5, 'air_util_tx', 1.5, 'uptime_seconds', (ts - ${start}) / 1000)
    FROM n, t;
    WITH RECURSIVE
      n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20),
      t(ts) AS (SELECT ${NOW - 7 * DAY} UNION ALL SELECT ts + ${STEP} FROM t WHERE ts + ${STEP} < ${NOW})
    INSERT INTO signal_log (connection_id, node_num, time, snr, rssi, hops)
    SELECT 1, i, ts, 5.5, -90, 0 FROM n, t;
  `);
  const rows = handle.sqlite.prepare("SELECT count(*) AS n FROM telemetry").get() as { n: number };
  expect(rows.n).toBe(NODES * DAYS * 96);
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
