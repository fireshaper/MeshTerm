import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

export const DB_FILENAME = "meshterm.db";

/**
 * Where Drizzle Kit writes migrations (`pnpm --filter @meshterm/server db:generate`).
 * Found relative to this module: `src/db/` in development, `dist/` when bundled.
 */
export function migrationsDir(): string {
  const candidates = ["../../drizzle/", "../drizzle/", "./drizzle/"].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  );
  const found = candidates.find((dir) => existsSync(join(dir, "meta", "_journal.json")));
  if (!found) throw new Error(`migrations folder not found; looked in ${candidates.join(", ")}`);
  return found;
}

/**
 * Opens (creating if needed) a SQLite database at `path`, or `:memory:` for tests,
 * with WAL and foreign keys on. Does not migrate; see {@link migrateDatabase}.
 */
export function openDatabase(path: string): DatabaseHandle {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    close: () => {
      sqlite.close();
    },
  };
}

/** Opens `<dataDir>/meshterm.db`, creating the directory if it is missing. */
export function openDataDirDatabase(dataDir: string): DatabaseHandle {
  return openDatabase(join(dataDir, DB_FILENAME));
}

/** Applies any pending migrations. Safe to run on every start. */
export function migrateDatabase(db: Db): void {
  migrate(db, { migrationsFolder: migrationsDir() });
}
