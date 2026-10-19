import type { Config } from "@meshterm/shared";
import { migrateDatabase, openDataDirDatabase, type DatabaseHandle } from "./database.js";
import { seedConnectionFromEnv, type SeedResult } from "./seed.js";

type DbConfig = Pick<Config, "nodeHost" | "nodePort">;

/** Migrates and seeds an open database; what every start does. */
export function prepareDatabase(
  handle: DatabaseHandle,
  config: DbConfig,
  now: number = Date.now(),
): SeedResult {
  migrateDatabase(handle.db);
  return seedConnectionFromEnv(handle.db, { host: config.nodeHost, port: config.nodePort }, now);
}

/** Opens `<dataDir>/meshterm.db`, then migrates and seeds it. */
export function initDatabase(
  config: DbConfig & Pick<Config, "dataDir">,
  now: number = Date.now(),
): { handle: DatabaseHandle; seed: SeedResult } {
  const handle = openDataDirDatabase(config.dataDir);
  try {
    return { handle, seed: prepareDatabase(handle, config, now) };
  } catch (err) {
    handle.close();
    throw err;
  }
}
