// Accounts, sessions, CSRF, roles and the audit log (CR-002 Phase L), with MESHTERM_AUTH=local.
import type { AuditPage, MeDTO, UserDTO } from "@meshterm/shared";
import type { LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";
import { WsTestClient } from "../ws/test-client.js";
import { hashPassword, verifyPassword } from "./password.js";

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** The app of the current test (started by `setup` or `startTestApp`). */
const app = () => {
  if (!t) throw new Error("no app");
  return t.app;
};

async function setup(env: Record<string, string> = {}) {
  t = await startTestApp({ env: { MESHTERM_AUTH: "local", ...env } });
}

/** A signed-in browser: its cookie and CSRF token. */
interface Session {
  cookie: string;
  csrf: string;
}

const cookieOf = (res: LightMyRequestResponse) => {
  const c = res.cookies.find((x) => x.name === "mt_session");
  if (!c) throw new Error("no session cookie");
  return `mt_session=${c.value}`;
};

async function me(cookie?: string): Promise<MeDTO> {
  return (
    await app().inject({ url: "/api/auth/me", ...(cookie ? { headers: { cookie } } : {}) })
  ).json<MeDTO>();
}

async function login(username: string, password: string): Promise<Session> {
  const res = await app().inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = cookieOf(res);
  return { cookie, csrf: (await me(cookie)).csrfToken };
}

async function firstAdmin(): Promise<Session> {
  const res = await app().inject({
    method: "POST",
    url: "/api/auth/setup",
    payload: { username: "Alice", password: "correct horse" },
  });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = cookieOf(res);
  return { cookie, csrf: (await me(cookie)).csrfToken };
}

const as = (
  s: Session | null,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
  csrf = true,
) =>
  app().inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: {
      ...(s ? { cookie: s.cookie } : {}),
      ...(s && csrf ? { "x-csrf-token": s.csrf } : {}),
    },
  });

describe("password hashing", () => {
  it("argon2id PHC strings that verify, with a fresh salt each time", async () => {
    const a = await hashPassword("hunter22");
    const b = await hashPassword("hunter22");
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("hunter22", a)).toBe(true);
    expect(await verifyPassword("hunter23", a)).toBe(false);
    expect(await verifyPassword("hunter22", "garbage")).toBe(false);
  });
});

describe("first run and sign-in", () => {
  it("everything but /healthz and /api/auth needs a session until setup creates the first admin", async () => {
    await setup();
    expect((await me()).setupRequired).toBe(true);
    expect((await app().inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await app().inject({ url: "/api/connections" })).statusCode).toBe(401);

    const admin = await firstAdmin();
    expect(await me(admin.cookie)).toMatchObject({
      mode: "local",
      user: { username: "alice", role: "admin" },
      setupRequired: false,
    });
    expect(admin.csrf.length).toBeGreaterThan(20);
    expect((await as(admin, "GET", "/api/connections")).statusCode).toBe(200);
    // Setup is locked once an account exists.
    const again = await app().inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "mallory", password: "takeover!!" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("the cookie is HTTP-only and SameSite=Lax; wrong passwords fail and are audited", async () => {
    await setup();
    const admin = await firstAdmin();
    const bad = await app().inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "nope" },
    });
    expect(bad.statusCode).toBe(401);
    const unknown = await app().inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nobody", password: "nope" },
    });
    expect(unknown.statusCode).toBe(401);
    const ok = await app().inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ALICE", password: "correct horse" },
    });
    const cookie = ok.cookies.find((c) => c.name === "mt_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    const audit = (await as(admin, "GET", "/api/audit")).json<AuditPage>().entries;
    expect(audit.filter((e) => e.action === "login").map((e) => [e.target, e.result])).toEqual([
      ["alice", "ok"],
      ["nobody", "failed"],
      ["alice", "failed"],
    ]);
  });

  it("logout ends the session", async () => {
    await setup();
    const admin = await firstAdmin();
    expect((await as(admin, "POST", "/api/auth/logout")).statusCode).toBe(200);
    expect((await as(admin, "GET", "/api/connections")).statusCode).toBe(401);
    expect((await me(admin.cookie)).user).toBeNull();
  });

  it("an initial admin can come from the environment", async () => {
    await setup({ MESHTERM_ADMIN_USERNAME: "root", MESHTERM_ADMIN_PASSWORD: "from-the-env" });
    expect((await me()).setupRequired).toBe(false);
    await login("root", "from-the-env");
  });

  it("login is rate-limited", async () => {
    await setup();
    await firstAdmin(); // setup has its own limit
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push(
        (
          await app().inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "alice", password: "wrong" },
          })
        ).statusCode,
      );
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});

describe("CSRF and roles", () => {
  it("state-changing requests need the session's CSRF token", async () => {
    await setup();
    const admin = await firstAdmin();
    const body = { text: "hello", channel: 0 };
    const missing = await as(admin, "POST", "/api/connections/1/messages", body, false);
    expect(missing.statusCode).toBe(403);
    expect(missing.json<{ error: string }>().error).toBe("csrf");
    const wrong = await app().inject({
      method: "POST",
      url: "/api/connections/1/messages",
      payload: body,
      headers: { cookie: admin.cookie, "x-csrf-token": "x".repeat(43) },
    });
    expect(wrong.statusCode).toBe(403);
    expect((await as(admin, "POST", "/api/connections/1/messages", body)).statusCode).toBe(201);
  });

  it("viewers read everything but can't send, favorite, reconnect or manage users", async () => {
    await setup();
    const admin = await firstAdmin();
    const created = await as(admin, "POST", "/api/users", {
      username: "vic",
      password: "just-looking",
      role: "viewer",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<UserDTO>()).toMatchObject({ username: "vic", role: "viewer" });
    const viewer = await login("vic", "just-looking");
    expect((await as(viewer, "GET", "/api/connections/1/messages?channel=0")).statusCode).toBe(200);
    for (const [method, url, body] of [
      ["POST", "/api/connections/1/messages", { text: "hi", channel: 0 }],
      ["PUT", "/api/connections/1/nodes/195939070/favorite", { favorite: true }],
      ["POST", "/api/connections/1/reconnect", undefined],
      ["GET", "/api/users", undefined],
      ["GET", "/api/audit", undefined],
    ] as const) {
      expect((await as(viewer, method, url, body)).statusCode, `${method} ${url}`).toBe(403);
    }
    const audit = (await as(admin, "GET", "/api/audit")).json<AuditPage>().entries;
    expect(audit.some((e) => e.action === "denied" && e.username === "vic")).toBe(true);
  });

  it("the last admin can't be demoted or deleted, nobody deletes themselves; changes sign out", async () => {
    await setup();
    const admin = await firstAdmin();
    const users = (await as(admin, "GET", "/api/users")).json<UserDTO[]>();
    const alice = users[0];
    if (!alice) throw new Error("no user");
    expect(
      (await as(admin, "PATCH", `/api/users/${alice.id}`, { role: "viewer" })).statusCode,
    ).toBe(409);
    expect((await as(admin, "DELETE", `/api/users/${alice.id}`)).statusCode).toBe(409);

    const bob = (
      await as(admin, "POST", "/api/users", {
        username: "bob",
        password: "bob-secret",
        role: "admin",
      })
    ).json<UserDTO>();
    const bobSession = await login("bob", "bob-secret");
    expect((await as(admin, "PATCH", `/api/users/${bob.id}`, { role: "viewer" })).statusCode).toBe(
      200,
    );
    // Bob's sessions ended: the new role applies at once.
    expect((await as(bobSession, "GET", "/api/connections")).statusCode).toBe(401);
    expect((await as(admin, "DELETE", `/api/users/${bob.id}`)).statusCode).toBe(200);
  });

  it("changing your password ends your other sessions", async () => {
    await setup();
    const here = await firstAdmin();
    const elsewhere = await login("alice", "correct horse");
    const wrong = await as(here, "PUT", "/api/auth/password", {
      current: "nope",
      next: "new-password",
    });
    expect(wrong.statusCode).toBe(400);
    const ok = await as(here, "PUT", "/api/auth/password", {
      current: "correct horse",
      next: "new-password",
    });
    expect(ok.statusCode).toBe(200);
    expect((await as(here, "GET", "/api/connections")).statusCode).toBe(200);
    expect((await as(elsewhere, "GET", "/api/connections")).statusCode).toBe(401);
    await login("alice", "new-password");
  });
});

describe("WebSocket", () => {
  it("refuses an upgrade without a session and accepts one with it", async () => {
    await setup();
    const admin = await firstAdmin();
    await app().listen({ host: "127.0.0.1", port: 0 });
    await expect(WsTestClient.open(app())).rejects.toThrow(/401/);
    const ws = await WsTestClient.open(app(), admin.cookie);
    ws.send({ type: "subscribe", connectionId: 1 });
    await ws.next("snapshot");
    ws.close();
  });
});

describe("MESHTERM_AUTH=none", () => {
  it("everyone is an admin and no CSRF token is needed", async () => {
    t = await startTestApp();
    expect(await me()).toMatchObject({
      mode: "none",
      user: { role: "admin" },
      csrfToken: "",
      setupRequired: false,
    });
    const res = await app().inject({
      method: "POST",
      url: "/api/connections/1/messages",
      payload: { text: "hi", channel: 0 },
    });
    expect(res.statusCode).toBe(201);
  });
});
