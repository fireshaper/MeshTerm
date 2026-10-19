import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DB_FILENAME, openDatabase, openDataDirDatabase, type DatabaseHandle } from "./database.js";

let handle: DatabaseHandle | undefined;
let tempRoot: string | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("openDataDirDatabase", () => {
  it("creates a missing data directory and the database file", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "meshterm-db-"));
    const dataDir = join(tempRoot, "nested", "data");
    handle = openDataDirDatabase(dataDir);
    expect(existsSync(join(dataDir, DB_FILENAME))).toBe(true);
  });

  it("turns on WAL and foreign keys", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "meshterm-db-"));
    handle = openDataDirDatabase(tempRoot);
    expect(handle.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("openDatabase(':memory:')", () => {
  it("works in memory with foreign keys on", () => {
    handle = openDatabase(":memory:");
    // WAL doesn't apply to in-memory databases.
    expect(handle.sqlite.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
