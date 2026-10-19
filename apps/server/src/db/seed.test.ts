import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase, openDataDirDatabase } from "./database.js";
import { connections } from "./schema.js";
import { seedConnectionFromEnv, type EnvNode } from "./seed.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "meshterm-seed-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** One "server start": open the data dir, migrate, seed, read the rows, close. */
function start(env: EnvNode) {
  const handle = openDataDirDatabase(dataDir);
  try {
    migrateDatabase(handle.db);
    const result = seedConnectionFromEnv(handle.db, env, 1_800_000_000_000);
    return { result, rows: handle.db.select().from(connections).all() };
  } finally {
    handle.close();
  }
}

describe("seedConnectionFromEnv", () => {
  it("creates one env row on first start", () => {
    const { result, rows } = start({ host: "192.168.1.50", port: 4403 });
    expect(result).toBe("created");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      host: "192.168.1.50",
      port: 4403,
      transport: "tcp",
      enabled: true,
      source: "env",
    });
  });

  it("keeps one row when restarted with the same environment", () => {
    start({ host: "192.168.1.50", port: 4403 });
    const { result, rows } = start({ host: "192.168.1.50", port: 4403 });
    expect(result).toBe("unchanged");
    expect(rows).toHaveLength(1);
  });

  it("updates that row in place when the port changes", () => {
    const first = start({ host: "192.168.1.50", port: 4403 });
    const { result, rows } = start({ host: "192.168.1.50", port: 4500 });
    expect(result).toBe("updated");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.rows[0]?.id);
    expect(rows[0]?.port).toBe(4500);
  });

  it("leaves user-added connections alone", () => {
    const handle = openDataDirDatabase(dataDir);
    migrateDatabase(handle.db);
    handle.db
      .insert(connections)
      .values({ name: "Mine", host: "10.0.0.9", port: 4403, source: "user", createdAt: 1 })
      .run();
    handle.close();
    const { result, rows } = start({ host: "192.168.1.50", port: 4403 });
    expect(result).toBe("skipped");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.host).toBe("10.0.0.9");
  });
});
