import { eq } from "drizzle-orm";
import type { Db } from "./database.js";
import { connections } from "./schema.js";

export interface EnvNode {
  host: string;
  port: number;
}

export type SeedResult = "created" | "updated" | "unchanged" | "skipped";

export const ENV_CONNECTION_NAME = "Primary node";

/**
 * Keeps one connection row in step with MESHTERM_NODE_HOST/PORT:
 * - no connections at all → insert one, flagged `source = 'env'`;
 * - an env row exists → update its host/port if they changed (same id, so history stays attached);
 * - only user-added rows exist → leave them alone.
 */
export function seedConnectionFromEnv(db: Db, env: EnvNode, now: number): SeedResult {
  return db.transaction((tx) => {
    const envRow = tx.select().from(connections).where(eq(connections.source, "env")).get();
    if (envRow) {
      if (envRow.host === env.host && envRow.port === env.port) return "unchanged";
      tx.update(connections)
        .set({ host: env.host, port: env.port })
        .where(eq(connections.id, envRow.id))
        .run();
      return "updated";
    }
    if (tx.select({ id: connections.id }).from(connections).limit(1).get()) return "skipped";
    tx.insert(connections)
      .values({
        name: ENV_CONNECTION_NAME,
        host: env.host,
        port: env.port,
        transport: "tcp",
        enabled: true,
        source: "env",
        createdAt: now,
      })
      .run();
    return "created";
  });
}
