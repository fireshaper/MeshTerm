import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase, openDatabase, type DatabaseHandle } from "./database.js";

let handle: DatabaseHandle;

beforeEach(() => {
  handle = openDatabase(":memory:");
});

afterEach(() => {
  handle.close();
});

function objects(type: "table" | "index"): string[] {
  return handle.sqlite
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all(type)
    .map((r) => r.name);
}

describe("migrations", () => {
  it("migrate a fresh database", () => {
    migrateDatabase(handle.db);
    expect(objects("table")).toEqual([
      "__drizzle_migrations",
      "activity",
      "channels",
      "connections",
      "messages",
      "nodes",
      "positions",
      "settings",
      "telemetry",
    ]);
    expect(objects("index")).toEqual(
      expect.arrayContaining([
        "messages_channel_idx",
        "messages_dedupe_idx",
        "messages_peer_idx",
        "messages_time_idx",
        "activity_time_idx",
      ]),
    );
  });

  it("are a no-op the second time", () => {
    migrateDatabase(handle.db);
    const count = () =>
      handle.sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
        n: number;
      };
    const before = count().n;
    expect(() => {
      migrateDatabase(handle.db);
    }).not.toThrow();
    expect(count().n).toBe(before);
  });

  it("index messages the way the queries need", () => {
    migrateDatabase(handle.db);
    const columns = (indexName: string) =>
      handle.sqlite
        .prepare<[], { name: string }>(`PRAGMA index_info(${indexName})`)
        .all()
        .map((r) => r.name);
    expect(columns("messages_channel_idx")).toEqual(["connection_id", "channel_index", "rx_time"]);
    expect(columns("messages_peer_idx")).toEqual(["connection_id", "peer", "rx_time"]);
    expect(columns("messages_dedupe_idx")).toEqual(["connection_id", "from_num", "packet_id"]);
  });

  it("have no PSK column anywhere", () => {
    migrateDatabase(handle.db);
    for (const table of objects("table")) {
      const cols = handle.sqlite
        .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
        .all()
        .map((r) => r.name);
      expect(cols.some((c) => c.includes("psk"))).toBe(false);
    }
  });
});
