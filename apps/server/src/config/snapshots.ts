import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConfigSnapshotSummary } from "@meshterm/shared";
import { and, desc, eq, notInArray } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { configSnapshots } from "../db/schema.js";

/** Snapshots kept per connection (CR-002 §5.7). */
export const SNAPSHOTS_KEPT = 20;

/** A 32-byte key from base64 or hex text; throws on anything else. */
export function parseSecretKey(text: string): Buffer {
  const t = text.trim();
  const key = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, "hex") : Buffer.from(t, "base64");
  if (key.length !== 32) throw new Error("MESHTERM_SECRET_KEY must be 32 bytes (base64 or hex)");
  return key;
}

/**
 * `MESHTERM_SECRET_KEY` if set; else `<dataDir>/secret.key`, created (mode 0600) on
 * first run. Losing the file only makes old snapshots unreadable.
 */
export function loadSecretKey(env: string | null, dataDir: string): Buffer {
  if (env) return parseSecretKey(env);
  const path = join(dataDir, "secret.key");
  if (existsSync(path)) return parseSecretKey(readFileSync(path, "utf8"));
  const key = randomBytes(32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${key.toString("base64")}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Not supported everywhere (Windows); the file was created with the mode anyway.
  }
  return key;
}

export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decrypt(key: Buffer, payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function saveSnapshot(
  db: Db,
  key: Buffer,
  snapshot: {
    connectionId: number;
    reason: ConfigSnapshotSummary["reason"];
    firmware: string | null;
    data: unknown;
    now: number;
  },
): number {
  const row = db
    .insert(configSnapshots)
    .values({
      connectionId: snapshot.connectionId,
      takenAt: snapshot.now,
      reason: snapshot.reason,
      firmware: snapshot.firmware,
      payload: encrypt(key, JSON.stringify(snapshot.data)),
    })
    .returning({ id: configSnapshots.id })
    .get();
  // Keep the newest SNAPSHOTS_KEPT.
  const keep = db
    .select({ id: configSnapshots.id })
    .from(configSnapshots)
    .where(eq(configSnapshots.connectionId, snapshot.connectionId))
    .orderBy(desc(configSnapshots.id))
    .limit(SNAPSHOTS_KEPT)
    .all()
    .map((r) => r.id);
  db.delete(configSnapshots)
    .where(
      and(
        eq(configSnapshots.connectionId, snapshot.connectionId),
        notInArray(configSnapshots.id, keep),
      ),
    )
    .run();
  return row.id;
}

export function listSnapshots(db: Db, connectionId: number): ConfigSnapshotSummary[] {
  return db
    .select({
      id: configSnapshots.id,
      takenAt: configSnapshots.takenAt,
      reason: configSnapshots.reason,
      firmware: configSnapshots.firmware,
    })
    .from(configSnapshots)
    .where(eq(configSnapshots.connectionId, connectionId))
    .orderBy(desc(configSnapshots.id))
    .all();
}

/** The decrypted snapshot data, or null (unknown id, or a key that can't open it). */
export function loadSnapshot(db: Db, key: Buffer, connectionId: number, id: number): unknown {
  const row = db
    .select()
    .from(configSnapshots)
    .where(and(eq(configSnapshots.connectionId, connectionId), eq(configSnapshots.id, id)))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(decrypt(key, row.payload)) as unknown;
  } catch {
    return null;
  }
}
