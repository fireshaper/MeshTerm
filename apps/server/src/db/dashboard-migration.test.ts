import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtures } from "@meshterm/shared";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase, migrationsDir, openDatabase, type DatabaseHandle } from "./database.js";
import { listNodes } from "./repositories.js";

let handle: DatabaseHandle | undefined;
let temp: string | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

const columns = (table: string) =>
  (handle?.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );

/** A copy of the migrations folder that stops before `0003_dashboard_data`. */
function migrationsUpTo0002(): string {
  temp = mkdtempSync(join(tmpdir(), "meshterm-mig-"));
  cpSync(migrationsDir(), temp, { recursive: true });
  const journalPath = join(temp, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= 2);
  writeFileSync(journalPath, JSON.stringify(journal));
  return temp;
}

describe("migration 0003 (dashboard data)", () => {
  it("adds the history tables, their indexes and the latest-value columns", () => {
    handle = openDatabase(":memory:");
    migrateDatabase(handle.db);
    expect(columns("positions")).toEqual([
      "id",
      "connection_id",
      "node_num",
      "lat",
      "lon",
      "altitude",
      "precision_bits",
      "time",
      "rx_time",
    ]);
    expect(columns("telemetry")).toEqual(
      expect.arrayContaining([
        "kind",
        "time",
        "battery_level",
        "voltage",
        "temperature",
        "pressure",
      ]),
    );
    expect(columns("nodes")).toEqual(
      expect.arrayContaining([
        "rssi",
        "lat",
        "lon",
        "altitude",
        "precision_bits",
        "position_time",
        "battery_level",
        "voltage",
        "channel_util",
        "air_util_tx",
        "uptime_seconds",
        "device_time",
        "temperature",
        "humidity",
        "pressure",
        "env_time",
      ]),
    );
    expect(columns("connections")).toContain("last_packet_at");
    const indexes = (
      handle.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining(["positions_node_time_idx", "telemetry_node_time_idx"]),
    );
  });

  it("upgrades a database holding base-app data without losing it", () => {
    handle = openDatabase(":memory:");
    migrate(handle.db, { migrationsFolder: migrationsUpTo0002() });
    // Raw SQL: Drizzle would also write the columns this older schema doesn't have yet.
    const sqlite = handle.sqlite;
    sqlite
      .prepare(
        "INSERT INTO connections (id, name, host, port, transport, enabled, source, created_at) VALUES (1, 'Home', '192.168.1.50', 4403, 'tcp', 1, 'env', 0)",
      )
      .run();
    const n = fixtures.node;
    sqlite
      .prepare(
        "INSERT INTO nodes (connection_id, num, long_name, short_name, hw_model, role, last_heard, snr, hops_away, is_favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
      )
      .run(1, n.num, n.longName, n.shortName, n.hwModel, n.role, n.lastHeard, n.snr, n.hopsAway);
    const m = fixtures.inboundMessage;
    sqlite
      .prepare(
        "INSERT INTO messages (id, connection_id, packet_id, from_num, to_num, peer, channel_index, text, rx_time, direction) VALUES (?, 1, ?, ?, ?, ?, 0, ?, ?, 'in')",
      )
      .run(m.id, m.packetId, m.fromNum, m.toNum, m.peer, m.text, m.rxTime);

    migrateDatabase(handle.db);
    expect(listNodes(handle.db, 1)).toEqual([{ ...fixtures.node, hasPublicKey: false }]);
    expect(handle.sqlite.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 1 });
    expect(handle.sqlite.prepare("SELECT lat, battery_level FROM nodes").get()).toEqual({
      lat: null,
      battery_level: null,
    });
  });
});
