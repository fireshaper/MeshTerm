import cookie from "@fastify/cookie";
import {
  AuditPage,
  ChangePasswordBody,
  CreateUserBody,
  CSRF_HEADER,
  LoginBody,
  MeDTO,
  SetupBody,
  UpdateUserBody,
  UserDTO,
  type AuthMode,
  type Role,
} from "@meshterm/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../clock.js";
import type { Db } from "../db/database.js";
import { HttpError } from "../routes/http-error.js";
import { dummyHash, hashPassword, verifyPassword } from "./password.js";
import {
  audit,
  countAdmins,
  countUsers,
  createSession,
  createUser,
  deleteSession,
  deleteUser,
  deleteUserSessions,
  findUser,
  findUserByName,
  listAudit,
  listUsers,
  pruneAudit,
  pruneSessions,
  resolveSession,
  toUserDTO,
  updateUser,
  type AuditInput,
  type SessionUser,
} from "./store.js";

export const SESSION_COOKIE = "mt_session";

/** Who is making the request; null when signed out. */
export type RequestAuth = SessionUser | null;

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuth;
  }
  interface FastifyContextConfig {
    /** Minimum role for the route (default: any signed-in user). */
    role?: Role;
    /** Reachable without signing in. */
    public?: boolean;
  }
}

/** In `none` mode every request acts as this admin. */
const NO_AUTH_ADMIN: SessionUser = {
  id: 0,
  username: "admin",
  role: "admin",
  csrfToken: "",
  tokenHash: "",
};

/** Login attempts per IP (successful or not). */
export const LOGIN_RATE_LIMIT = { max: 10, timeWindow: 60_000 };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** Paths that need a session: the API (except what's marked public) and the WebSocket. */
const guarded = (url: string) => {
  const path = url.split("?")[0] ?? url;
  return path === "/ws" || path === "/api" || path.startsWith("/api/");
};

export interface AuthOptions {
  db: Db;
  clock: Clock;
  mode: AuthMode;
  sessionDays: number;
  initialAdmin: { username: string; password: string } | null;
}

/**
 * Accounts, sessions, CSRF and roles (CR-002 Phase L). Every API route and the
 * WebSocket need a session unless their route config says `public`; state-changing
 * requests need the session's CSRF token in `x-csrf-token`; routes with
 * `config.role = "admin"` need an admin. In `none` mode everyone is an admin.
 */
export function authPlugin(options: AuthOptions) {
  const { db, clock, mode } = options;
  const lifetimeMs = options.sessionDays * 24 * 3600_000;

  // fastify-plugin: the hooks and the `auth` decoration must apply to every route.
  const plugin: FastifyPluginAsyncZod = async (app) => {
    await app.register(cookie);
    app.decorateRequest("auth", null);

    if (mode === "local" && options.initialAdmin && countUsers(db) === 0) {
      const { username, password } = options.initialAdmin;
      createUser(db, username, await hashPassword(password), "admin", clock.now());
      audit(
        db,
        {
          username: null,
          action: "user.create",
          target: username.toLowerCase(),
          details: { role: "admin", source: "env" },
        },
        clock.now(),
      );
      app.log.info({ username }, "created the first admin from MESHTERM_ADMIN_USERNAME");
    }
    if (mode === "local" && countUsers(db) === 0) {
      app.log.warn("no accounts yet: open MeshTerm in a browser to create the first admin");
    }
    pruneSessions(db, clock.now());
    pruneAudit(db, clock.now());

    const record = (
      req: FastifyRequest,
      entry: Omit<AuditInput, "ip" | "username">,
      username = req.auth?.username ?? null,
    ) => {
      audit(db, { ...entry, username, ip: req.ip }, clock.now());
    };

    // Resolve who is asking (every request; cheap: one indexed lookup).
    app.addHook("onRequest", (req, _reply, done) => {
      if (mode === "none") {
        req.auth = NO_AUTH_ADMIN;
      } else {
        const value = req.cookies[SESSION_COOKIE];
        req.auth = value ? resolveSession(db, value, clock.now()) : null;
      }
      done();
    });

    // Enforce: session, CSRF, role.
    app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      if (!guarded(req.url) || req.routeOptions.config.public) return;
      if (!req.auth) {
        return reply.code(401).send({ error: "unauthorized", message: "sign in first" });
      }
      if (mode === "local" && !SAFE_METHODS.has(req.method)) {
        const header = req.headers[CSRF_HEADER];
        if (typeof header !== "string" || !sameToken(header, req.auth.csrfToken)) {
          return reply.code(403).send({ error: "csrf", message: "missing or wrong CSRF token" });
        }
      }
      if (req.routeOptions.config.role === "admin" && req.auth.role !== "admin") {
        record(req, {
          action: "denied",
          target: `${req.method} ${req.routeOptions.url ?? req.url}`,
          result: "denied",
        });
        return reply.code(403).send({ error: "forbidden", message: "admins only" });
      }
    });

    const startSession = (req: FastifyRequest, reply: FastifyReply, userId: number) => {
      const value = createSession(db, userId, clock.now(), lifetimeMs);
      void reply.setCookie(SESSION_COOKIE, value, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        // MeshTerm is often plain HTTP on a LAN; mark Secure whenever it isn't.
        secure: req.protocol === "https",
        maxAge: Math.floor(lifetimeMs / 1000),
      });
    };

    const me = (req: FastifyRequest): MeDTO => ({
      mode,
      user: req.auth ? { id: req.auth.id, username: req.auth.username, role: req.auth.role } : null,
      csrfToken: mode === "local" ? (req.auth?.csrfToken ?? "") : "",
      setupRequired: mode === "local" && countUsers(db) === 0,
    });

    // ------------------------------------------------------------- endpoints

    app.get(
      "/api/auth/me",
      { config: { public: true }, schema: { response: { 200: MeDTO } } },
      (req) => me(req),
    );

    app.post(
      "/api/auth/setup",
      { config: { public: true, rateLimit: LOGIN_RATE_LIMIT }, schema: { body: SetupBody } },
      async (req, reply) => {
        if (mode !== "local") throw new HttpError(404, "not_found", "accounts are off");
        const hash = await hashPassword(req.body.password);
        // Only while no account exists (checked again inside the write).
        const user = db.transaction((tx) =>
          countUsers(tx) === 0
            ? createUser(tx, req.body.username, hash, "admin", clock.now())
            : null,
        );
        if (!user) throw new HttpError(409, "setup_done", "setup is already done; sign in");
        record(
          req,
          {
            action: "user.create",
            target: user.username,
            details: { role: "admin", source: "setup" },
          },
          user.username,
        );
        startSession(req, reply, user.id);
        return { ok: true };
      },
    );

    app.post(
      "/api/auth/login",
      { config: { public: true, rateLimit: LOGIN_RATE_LIMIT }, schema: { body: LoginBody } },
      async (req, reply) => {
        if (mode !== "local") throw new HttpError(404, "not_found", "accounts are off");
        const user = findUserByName(db, req.body.username);
        const ok = await verifyPassword(
          req.body.password,
          user?.passwordHash ?? (await dummyHash()),
        );
        if (!user || !ok) {
          record(req, { action: "login", target: req.body.username, result: "failed" }, null);
          throw new HttpError(401, "bad_credentials", "wrong username or password");
        }
        updateUser(db, user.id, { lastLoginAt: clock.now() });
        record(req, { action: "login", target: user.username }, user.username);
        startSession(req, reply, user.id);
        return { ok: true };
      },
    );

    app.post("/api/auth/logout", { config: { public: true } }, (req, reply) => {
      if (req.auth?.tokenHash) {
        deleteSession(db, req.auth.tokenHash);
        record(req, { action: "logout", target: req.auth.username });
      }
      void reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });

    app.put("/api/auth/password", { schema: { body: ChangePasswordBody } }, async (req) => {
      const auth = req.auth;
      const user = auth && mode === "local" ? findUser(db, auth.id) : null;
      if (!auth || !user) throw new HttpError(404, "not_found", "accounts are off");
      if (!(await verifyPassword(req.body.current, user.passwordHash))) {
        record(req, { action: "password.change", target: user.username, result: "failed" });
        throw new HttpError(400, "bad_credentials", "the current password is wrong");
      }
      updateUser(db, user.id, { passwordHash: await hashPassword(req.body.next) });
      // Other sessions of this account end; this one stays.
      deleteUserSessions(db, user.id, auth.tokenHash);
      record(req, { action: "password.change", target: user.username });
      return { ok: true };
    });

    // ------------------------------------------------------- users (admin)

    const UserParams = z.object({ id: z.coerce.number().int().positive() });

    app.get(
      "/api/users",
      { config: { role: "admin" }, schema: { response: { 200: z.array(UserDTO) } } },
      () => listUsers(db),
    );

    app.post(
      "/api/users",
      { config: { role: "admin" }, schema: { body: CreateUserBody, response: { 201: UserDTO } } },
      async (req, reply) => {
        const { username, password, role } = req.body;
        const user = createUser(db, username, await hashPassword(password), role, clock.now());
        if (!user) throw new HttpError(409, "taken", `${username} already exists`);
        record(req, { action: "user.create", target: user.username, details: { role } });
        return reply.code(201).send(toUserDTO(user));
      },
    );

    app.patch(
      "/api/users/:id",
      {
        config: { role: "admin" },
        schema: { params: UserParams, body: UpdateUserBody, response: { 200: UserDTO } },
      },
      async (req) => {
        const user = findUser(db, req.params.id);
        if (!user) throw new HttpError(404, "not_found", "no such user");
        const { role, password } = req.body;
        if (role === "viewer" && user.role === "admin" && countAdmins(db) <= 1) {
          throw new HttpError(409, "last_admin", "the last admin can't become a viewer");
        }
        updateUser(db, user.id, {
          ...(role ? { role } : {}),
          ...(password ? { passwordHash: await hashPassword(password) } : {}),
        });
        // A new role or password applies at once: sign them out everywhere.
        deleteUserSessions(db, user.id, user.id === req.auth?.id ? req.auth.tokenHash : undefined);
        record(req, {
          action: "user.update",
          target: user.username,
          details: { ...(role ? { role } : {}), ...(password ? { password: "changed" } : {}) },
        });
        const updated = findUser(db, user.id);
        if (!updated) throw new HttpError(404, "not_found", "no such user");
        return toUserDTO(updated);
      },
    );

    app.delete(
      "/api/users/:id",
      { config: { role: "admin" }, schema: { params: UserParams } },
      (req) => {
        const user = findUser(db, req.params.id);
        if (!user) throw new HttpError(404, "not_found", "no such user");
        if (user.id === req.auth?.id) throw new HttpError(409, "self", "you can't delete yourself");
        if (user.role === "admin" && countAdmins(db) <= 1) {
          throw new HttpError(409, "last_admin", "the last admin can't be deleted");
        }
        deleteUser(db, user.id);
        record(req, { action: "user.delete", target: user.username });
        return { ok: true };
      },
    );

    app.get(
      "/api/audit",
      {
        config: { role: "admin" },
        schema: {
          querystring: z.object({
            before: z.coerce.number().int().positive().optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
          }),
          response: { 200: AuditPage },
        },
      },
      (req) => listAudit(db, { before: req.query.before ?? null, limit: req.query.limit }),
    );
  };
  return fp(plugin, { name: "meshterm-auth" });
}

/** Writes an audit entry for a request (used by other route modules, e.g. config). */
export function auditRequest(
  db: Db,
  clock: Clock,
  req: FastifyRequest,
  entry: Omit<AuditInput, "ip" | "username">,
): void {
  audit(db, { ...entry, username: req.auth?.username ?? null, ip: req.ip }, clock.now());
}
