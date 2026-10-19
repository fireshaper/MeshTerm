import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";
import { IMMUTABLE, isReservedPath, NO_CACHE } from "./static.js";

const INDEX = "<!doctype html><title>MeshTerm test</title>";
let root: string;
let t: TestApp;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "meshterm-static-"));
  const web = join(root, "web");
  mkdirSync(join(web, "assets"), { recursive: true });
  writeFileSync(join(web, "index.html"), INDEX);
  writeFileSync(join(web, "assets", "index-Ab12Cd34.js"), "console.log(1)");
  const themes = join(root, "themes");
  mkdirSync(join(themes, "default"), { recursive: true });
  writeFileSync(join(themes, "default", "theme.css"), "@layer theme {}");
  t = await startTestApp({ deps: { webDir: web, themesDir: themes } });
});

afterAll(async () => {
  await t.close();
  rmSync(root, { recursive: true, force: true });
});

const get = (url: string) => t.app.inject({ method: "GET", url });

describe("SPA serving", () => {
  it("serves index.html at / and for client-side routes, without caching", async () => {
    for (const url of ["/", "/channels/0", "/dm/195939070", "/nodes?sort=name"]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toBe(INDEX);
      expect(res.headers["content-type"], url).toMatch(/text\/html/);
      expect(res.headers["cache-control"], url).toBe(NO_CACHE);
    }
  });

  it("serves hashed assets with a long immutable cache", async () => {
    const res = await get("/assets/index-Ab12Cd34.js");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(IMMUTABLE);
  });

  it("never swallows /api, /ws or missing files", async () => {
    const api = await get("/api/does-not-exist");
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({
      error: "not_found",
      message: "GET /api/does-not-exist not found",
    });
    expect((await get("/api")).statusCode).toBe(404);
    expect((await get("/assets/missing-123.js")).statusCode).toBe(404);
    expect((await get("/favicon.ico")).statusCode).toBe(404);
    expect((await get("/api/connections")).json()).toHaveLength(1);
  });

  it("serves themes without caching", async () => {
    const res = await get("/themes/default/theme.css");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("@layer theme {}");
    expect(res.headers["cache-control"]).toBe(NO_CACHE);
    expect((await get("/themes/nope/theme.css")).statusCode).toBe(404);
  });

  it("falls back only for GET", async () => {
    const res = await t.app.inject({ method: "POST", url: "/channels/0" });
    expect(res.statusCode).toBe(404);
  });
});

describe("isReservedPath", () => {
  it.each([
    ["/api", true],
    ["/api/x", true],
    ["/ws", true],
    ["/ws?x=1", true],
    ["/healthz", true],
    ["/themes/default/theme.css", true],
    ["/apiary", false],
    ["/wsx", false],
    ["/channels/0", false],
  ])("%s → %s", (url, reserved) => {
    expect(isReservedPath(url)).toBe(reserved);
  });
});
