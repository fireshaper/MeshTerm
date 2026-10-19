import { fixtures } from "@meshterm/shared";
import { migrateDatabase, openDatabase, type DatabaseHandle } from "./database.js";
import { connections } from "./schema.js";

/** A migrated in-memory database holding the `fixtures.connection` row (id 1). */
export function openTestDatabase(): DatabaseHandle {
  const handle = openDatabase(":memory:");
  migrateDatabase(handle.db);
  const { id, name, host, port, transport, enabled } = fixtures.connection;
  handle.db
    .insert(connections)
    .values({ id, name, host, port, transport, enabled, source: "env", createdAt: 0 })
    .run();
  return handle;
}
