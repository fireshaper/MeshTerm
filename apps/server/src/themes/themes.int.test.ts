import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until } from "@meshterm/fake-node";
import type { ServerMessage, ThemeDTO, ThemesDTO } from "@meshterm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IMMUTABLE, NO_CACHE } from "../routes/static.js";
import { startTestApp, type TestApp } from "../test-app.js";

const manifest = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id,
    name: id.toUpperCase(),
    version: "1.0.0",
    colorScheme: "dark",
    preview: { bg: "#000", surface: "#111", accent: "#0af", text: "#fff" },
    ...extra,
  });

function writeTheme(root: string, id: string, css = "@layer theme {}", extra = {}) {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "theme.json"), manifest(id, extra));
  writeFileSync(join(root, id, "theme.css"), css);
}

let root: string;
let builtin: string;
let user: string;
let t: TestApp;
const events: ServerMessage[] = [];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "meshterm-themes-"));
  builtin = join(root, "builtin");
  user = join(root, "user");
  writeTheme(builtin, "default", "@layer theme { :root { --mt-x: 1; } }");
  writeTheme(builtin, "retro", "@layer theme {}");
  writeFileSync(join(builtin, "retro", "evil.js"), "alert(1)");
  writeFileSync(join(builtin, "retro", ".secret.css"), "x");
  mkdirSync(join(builtin, "retro", "fonts"));
  writeFileSync(join(builtin, "retro", "fonts", "mono.woff2"), "font");
  writeFileSync(join(root, "outside.css"), "outside");
  writeTheme(
    user,
    "mine",
    "@layer theme { body { background: url(https://evil.example/x.png); } }",
  );
  mkdirSync(join(user, "broken"), { recursive: true });
  writeFileSync(join(user, "broken", "theme.json"), "{ nope");
  t = await startTestApp({ deps: { themesDir: builtin, userThemesDir: user } });
  t.app.meshterm.hub.subscribe("theme.changed", (p) => {
    events.push({ type: "theme.changed", ...p });
  });
});

afterAll(async () => {
  await t.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  events.length = 0;
});

const get = (url: string, headers: Record<string, string> = {}) =>
  t.app.inject({ method: "GET", url, headers });
const list = async () => (await get("/api/themes")).json<ThemesDTO>();
const theme = async (id: string): Promise<ThemeDTO | undefined> =>
  (await list()).themes.find((x) => x.id === id);

describe("GET /api/themes (CR-004 A1)", () => {
  it("lists built-in and user themes, Default first, broken ones with their error", async () => {
    const { themes, defaultId } = await list();
    expect(defaultId).toBe("default");
    expect(themes.map((x) => [x.id, x.source, x.valid])).toEqual([
      ["default", "builtin", true],
      ["broken", "user", false],
      ["mine", "user", true],
      ["retro", "builtin", true],
    ]);
    expect(themes.find((x) => x.id === "broken")?.error).toBe("theme.json isn't valid JSON");
    expect(themes.find((x) => x.id === "mine")?.warnings?.[0]).toMatch(/outside MeshTerm/);
    expect(themes.find((x) => x.id === "retro")?.hash).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("theme files", () => {
  it("serves allowlisted files, cached for good only with the current hash", async () => {
    const hash = (await theme("default"))?.hash ?? "";
    const plain = await get("/themes/default/theme.css");
    expect(plain.statusCode).toBe(200);
    expect(plain.headers["content-type"]).toMatch(/^text\/css/);
    expect(plain.headers["cache-control"]).toBe(NO_CACHE);
    expect((await get(`/themes/default/theme.css?v=${hash}`)).headers["cache-control"]).toBe(
      IMMUTABLE,
    );
    expect((await get("/themes/default/theme.css?v=stale")).headers["cache-control"]).toBe(
      NO_CACHE,
    );
    const etag = String(plain.headers.etag);
    expect((await get("/themes/default/theme.css", { "if-none-match": etag })).statusCode).toBe(
      304,
    );
    expect((await get("/themes/retro/fonts/mono.woff2")).headers["content-type"]).toBe(
      "font/woff2",
    );
  });

  it.each([
    "/themes/retro/evil.js",
    "/themes/retro/.secret.css",
    "/themes/retro/../outside.css",
    "/themes/retro/%2e%2e/outside.css",
    "/themes/retro/..%2foutside.css",
    "/themes/retro/fonts/..%2f..%2f..%2foutside.css",
    "/themes/retro/C:%5cWindows%5cwin.ini",
    "/themes/broken/theme.json",
    "/themes/nope/theme.css",
    "/themes/retro/missing.css",
  ])("refuses %s", async (url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toBe("outside");
  });

  it.skipIf(process.platform === "win32")(
    "doesn't follow a symlink out of the folder",
    async () => {
      symlinkSync(join(root, "outside.css"), join(builtin, "retro", "link.css"));
      try {
        expect((await get("/themes/retro/link.css")).statusCode).toBe(404);
      } finally {
        unlinkSync(join(builtin, "retro", "link.css"));
      }
    },
  );
});

describe("server default", () => {
  it("admins set it to a working theme; unknown or broken ids are refused", async () => {
    const put = (id: string) =>
      t.app.inject({ method: "PUT", url: "/api/themes/default", payload: { id } });
    expect((await put("retro")).statusCode).toBe(200);
    expect((await get("/api/themes/default")).json()).toEqual({ id: "retro" });
    expect((await list()).defaultId).toBe("retro");
    expect((await put("broken")).statusCode).toBe(404);
    expect((await put("Not An Id")).statusCode).toBe(400);
    expect((await put("default")).statusCode).toBe(200);
  });
});

describe("hot reload", () => {
  it("a new folder appears, an edit changes the hash, a removal is announced", async () => {
    writeTheme(user, "dropped");
    await until(() => events.some((e) => e.type === "theme.changed" && e.id === "dropped"), 3_000);
    const first = await theme("dropped");
    expect(first?.valid).toBe(true);

    events.length = 0;
    writeFileSync(join(user, "dropped", "theme.css"), "@layer theme { :root { --mt-y: 2; } }");
    await until(() => events.some((e) => e.type === "theme.changed" && e.id === "dropped"), 3_000);
    const edited = await theme("dropped");
    expect(edited?.hash).not.toBe(first?.hash);
    expect(events.at(-1)).toMatchObject({ id: "dropped", hash: edited?.hash });

    events.length = 0;
    rmSync(join(user, "dropped"), { recursive: true, force: true });
    await until(() => events.some((e) => e.type === "theme.changed" && e.id === "dropped"), 3_000);
    expect(events.at(-1)).toMatchObject({ id: "dropped", removed: true });
    expect(await theme("dropped")).toBeUndefined();
  });

  it("a valid user copy overrides a built-in; a broken one doesn't", async () => {
    writeTheme(user, "retro", "@layer theme { :root { --mt-user: 1; } }");
    await until(() => events.some((e) => e.type === "theme.changed" && e.id === "retro"), 3_000);
    expect((await theme("retro"))?.source).toBe("override");
    expect((await get("/themes/retro/theme.css")).body).toContain("--mt-user");

    events.length = 0;
    writeFileSync(join(user, "retro", "theme.json"), manifest("retro", { version: "one" }));
    await until(() => events.some((e) => e.type === "theme.changed" && e.id === "retro"), 3_000);
    const back = await theme("retro");
    expect(back?.source).toBe("builtin");
    expect(back?.warnings?.[0]).toMatch(/user copy .* is broken: theme.json: version/);
    expect((await get("/themes/retro/theme.css")).body).not.toContain("--mt-user");
    rmSync(join(user, "retro"), { recursive: true, force: true });
  });
});

describe("POST /api/themes/:id/duplicate", () => {
  it("copies the served files into the data folder with a new id and name", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/themes/retro/duplicate",
      payload: { newId: "my-retro", name: "My Retro" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<ThemeDTO>()).toMatchObject({
      id: "my-retro",
      source: "user",
      valid: true,
      manifest: { id: "my-retro", name: "My Retro" },
    });
    expect((await get("/themes/my-retro/fonts/mono.woff2")).statusCode).toBe(200);
    expect((await get("/themes/my-retro/evil.js")).statusCode).toBe(404);
    expect(events).toContainEqual(expect.objectContaining({ id: "my-retro" }));

    const again = await t.app.inject({
      method: "POST",
      url: "/api/themes/retro/duplicate",
      payload: { newId: "my-retro", name: "Again" },
    });
    expect(again.statusCode).toBe(409);
    const broken = await t.app.inject({
      method: "POST",
      url: "/api/themes/broken/duplicate",
      payload: { newId: "fixed", name: "Fixed" },
    });
    expect(broken.statusCode).toBe(404);
    const audit = await get("/api/audit");
    expect(audit.body).toContain("theme.duplicate");
  });
});
