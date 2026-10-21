import { createHash, randomBytes } from "node:crypto";
import type { AuditEntryDTO, AuditResult, Role, UserDTO } from "@meshterm/shared";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { auditLog, sessions, users } from "../db/schema.js";

type UserRow = typeof users.$inferSelect;

export const toUserDTO = (u: UserRow): UserDTO => ({
  id: u.id,
  username: u.username,
  role: u.role,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

export const countUsers = (db: Db): number =>
  db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .get()?.n ?? 0;

export const countAdmins = (db: Db): number =>
  db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, "admin"))
    .get()?.n ?? 0;

export const findUserByName = (db: Db, username: string): UserRow | null =>
  db.select().from(users).where(eq(users.username, username.toLowerCase())).get() ?? null;

export const findUser = (db: Db, id: number): UserRow | null =>
  db.select().from(users).where(eq(users.id, id)).get() ?? null;

export const listUsers = (db: Db): UserDTO[] =>
  db.select().from(users).orderBy(users.username).all().map(toUserDTO);

/** Null when the name is taken. */
export function createUser(
  db: Db,
  username: string,
  passwordHash: string,
  role: Role,
  now: number,
): UserRow | null {
  // No row when the name is taken.
  const [row] = db
    .insert(users)
    .values({ username: username.toLowerCase(), passwordHash, role, createdAt: now })
    .onConflictDoNothing()
    .returning()
    .all();
  return row ?? null;
}

export function updateUser(
  db: Db,
  id: number,
  patch: { role?: Role; passwordHash?: string; lastLoginAt?: number },
): void {
  db.update(users).set(patch).where(eq(users.id, id)).run();
}

export function deleteUser(db: Db, id: number): void {
  db.delete(users).where(eq(users.id, id)).run();
}

// ------------------------------------------------------------------ sessions

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");

/** A session stops working this long after its last request. */
export const SESSION_IDLE_MS = 7 * 24 * 3600_000;
/** `last_seen_at` is written at most this often (not on every request). */
const TOUCH_EVERY_MS = 60_000;

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  csrfToken: string;
  tokenHash: string;
}

/** Returns the cookie value (only its hash is stored). */
export function createSession(db: Db, userId: number, now: number, lifetimeMs: number): string {
  const value = token();
  db.insert(sessions)
    .values({
      tokenHash: sha256(value),
      userId,
      csrfToken: token(),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + lifetimeMs,
    })
    .run();
  return value;
}

/** The signed-in user for a cookie value, or null (unknown, expired or idle too long). */
export function resolveSession(db: Db, value: string, now: number): SessionUser | null {
  const tokenHash = sha256(value);
  const row = db
    .select({
      userId: users.id,
      username: users.username,
      role: users.role,
      csrfToken: sessions.csrfToken,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .get();
  if (!row) return null;
  if (row.expiresAt <= now || now - row.lastSeenAt > SESSION_IDLE_MS) {
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    return null;
  }
  if (now - row.lastSeenAt > TOUCH_EVERY_MS) {
    db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash)).run();
  }
  return {
    id: row.userId,
    username: row.username,
    role: row.role,
    csrfToken: row.csrfToken,
    tokenHash,
  };
}

export function deleteSession(db: Db, tokenHash: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
}

/** Signs a user out everywhere, except (optionally) the session making the change. */
export function deleteUserSessions(db: Db, userId: number, keepTokenHash?: string): void {
  db.delete(sessions)
    .where(
      keepTokenHash
        ? and(eq(sessions.userId, userId), sql`${sessions.tokenHash} != ${keepTokenHash}`)
        : eq(sessions.userId, userId),
    )
    .run();
}

export function pruneSessions(db: Db, now: number): void {
  db.delete(sessions)
    .where(
      sql`${sessions.expiresAt} <= ${now} OR ${sessions.lastSeenAt} < ${now - SESSION_IDLE_MS}`,
    )
    .run();
}

// --------------------------------------------------------------------- audit

export interface AuditInput {
  username: string | null;
  action: string;
  target?: string | null;
  /** Never put secrets here (passwords, keys, PSKs). */
  details?: Record<string, unknown> | null;
  result?: AuditResult;
  ip?: string | null;
}

/** Entries are kept this long. */
export const AUDIT_MAX_AGE_MS = 365 * 24 * 3600_000;

export function audit(db: Db, entry: AuditInput, now: number): void {
  db.insert(auditLog)
    .values({
      time: now,
      username: entry.username,
      action: entry.action,
      target: entry.target ?? null,
      details: entry.details ?? null,
      result: entry.result ?? "ok",
      ip: entry.ip ?? null,
    })
    .run();
}

export function listAudit(db: Db, options: { before: number | null; limit: number }) {
  const rows = db
    .select()
    .from(auditLog)
    .where(options.before ? lt(auditLog.id, options.before) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(options.limit)
    .all();
  const entries: AuditEntryDTO[] = rows.map((r) => ({ ...r, details: r.details ?? null }));
  return {
    entries,
    nextBefore: rows.length === options.limit ? (rows.at(-1)?.id ?? null) : null,
  };
}

export function pruneAudit(db: Db, now: number): void {
  db.delete(auditLog)
    .where(lt(auditLog.time, now - AUDIT_MAX_AGE_MS))
    .run();
}
