import { z } from "zod";
import { EpochMs } from "./domain.js";

/** `local`: accounts and sessions. `none`: no login, everyone is an admin (dev, tests). */
export const AuthMode = z.enum(["local", "none"]);
export type AuthMode = z.infer<typeof AuthMode>;

/** Admins change things (send, favorites, config, users); viewers only look. */
export const Role = z.enum(["admin", "viewer"]);
export type Role = z.infer<typeof Role>;

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9_.-]{0,31}$/,
    "1–32 letters, digits, or . _ - (starting with a letter or digit)",
  );

/** Long enough to resist guessing; a cap keeps hashing cheap to request. */
export const Password = z
  .string()
  .min(8, "at least 8 characters")
  .max(256, "at most 256 characters");

export const UserDTO = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  role: Role,
  createdAt: EpochMs,
  lastLoginAt: EpochMs.nullable(),
});
export type UserDTO = z.infer<typeof UserDTO>;

/** `GET /api/auth/me`: who is signed in, and what the client needs to act. */
export const MeDTO = z.object({
  mode: AuthMode,
  /** Null when signed out (local mode). In `none` mode a built-in admin. */
  user: z
    .object({ id: z.number().int().nonnegative(), username: z.string(), role: Role })
    .nullable(),
  /** Send as `x-csrf-token` on every non-GET request; empty when signed out or in `none` mode. */
  csrfToken: z.string(),
  /** No accounts exist yet: the first one is created at setup. */
  setupRequired: z.boolean(),
});
export type MeDTO = z.infer<typeof MeDTO>;

export const LoginBody = z.object({ username: Username, password: z.string().min(1).max(256) });
export const SetupBody = z.object({ username: Username, password: Password });
export const ChangePasswordBody = z.object({ current: z.string().min(1).max(256), next: Password });
export const CreateUserBody = z.object({ username: Username, password: Password, role: Role });
export const UpdateUserBody = z
  .object({ role: Role.optional(), password: Password.optional() })
  .refine((b) => b.role !== undefined || b.password !== undefined, {
    message: "give a role or a password",
  });

/** The header that carries the CSRF token on state-changing requests. */
export const CSRF_HEADER = "x-csrf-token";

export const AuditResult = z.enum(["ok", "denied", "failed"]);
export type AuditResult = z.infer<typeof AuditResult>;

/** One audit log entry (never contains secrets). */
export const AuditEntryDTO = z.object({
  id: z.number().int().positive(),
  time: EpochMs,
  /** Null for anonymous (failed login) or the system. */
  username: z.string().nullable(),
  action: z.string(),
  target: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  result: AuditResult,
  ip: z.string().nullable(),
});
export type AuditEntryDTO = z.infer<typeof AuditEntryDTO>;

export const AuditPage = z.object({
  entries: z.array(AuditEntryDTO),
  /** `before` for the next older page; null when there is nothing older. */
  nextBefore: z.number().int().positive().nullable(),
});
export type AuditPage = z.infer<typeof AuditPage>;
