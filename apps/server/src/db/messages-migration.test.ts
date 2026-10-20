import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase, migrationsDir, openDatabase, type DatabaseHandle } from "./database.js";

let handle: DatabaseHandle | undefined;
let temp: string | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

/** A copy of the migrations folder that stops before `0007_messages_overhaul`. */
function migrationsUpTo0006(): string {
  temp = mkdtempSync(join(tmpdir(), "meshterm-mig-"));
  cpSync(migrationsDir(), temp, { recursive: true });
  const journalPath = join(temp, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= 6);
  writeFileSync(journalPath, JSON.stringify(journal));
  return temp;
}

describe("migration 0007 (messages overhaul)", () => {
  it("re-files our own node's DMs as outgoing and defaults the new columns", () => {
    handle = openDatabase(":memory:");
    migrate(handle.db, { migrationsFolder: migrationsUpTo0006() });
    const { sqlite } = handle;
    sqlite
      .prepare(
        "INSERT INTO connections (id, name, host, port, transport, enabled, my_node_num, created_at) VALUES (1, 'n', 'h', 4403, 'tcp', 1, 100, 1)",
      )
      .run();
    const insert = sqlite.prepare(
      "INSERT INTO messages (id, connection_id, packet_id, from_num, to_num, peer, channel_index, text, rx_time, direction) VALUES (?, 1, ?, ?, ?, ?, 0, ?, 1, 'in')",
    );
    insert.run("a", 1, 100, 200, 100, "echo of mine");
    insert.run("b", 2, 200, 100, 200, "from them");
    migrateDatabase(handle.db);

    const rows = sqlite
      .prepare("SELECT id, peer, direction, pki_encrypted, emoji FROM messages ORDER BY id")
      .all();
    expect(rows).toEqual([
      { id: "a", peer: 200, direction: "out", pki_encrypted: 0, emoji: 0 },
      { id: "b", peer: 200, direction: "in", pki_encrypted: 0, emoji: 0 },
    ]);
  });
});
