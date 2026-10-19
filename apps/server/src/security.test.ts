import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cspDirectives, inlineStyleHashes } from "./security.js";
import { startTestApp, type TestApp } from "./test-app.js";

const STYLE = "@layer reset,base,theme,overrides;";
const HASH = `'sha256-${createHash("sha256").update(STYLE).digest("base64")}'`;

describe("inlineStyleHashes", () => {
  it("hashes each inline <style> block's exact contents", () => {
    expect(
      inlineStyleHashes(`<head><style>${STYLE}</style><style media="x">a{}</style></head>`),
    ).toEqual([HASH, `'sha256-${createHash("sha256").update("a{}").digest("base64")}'`]);
    expect(inlineStyleHashes("<p>no styles</p>")).toEqual([]);
  });

  it("never asks browsers to upgrade requests to HTTPS", () => {
    expect(cspDirectives([]).upgradeInsecureRequests).toBeNull();
  });
});

describe("security headers", () => {
  let root: string;
  let t: TestApp;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "meshterm-csp-"));
    mkdirSync(join(root, "web"));
    writeFileSync(
      join(root, "web", "index.html"),
      `<!doctype html><style>${STYLE}</style><div id="root"></div>`,
    );
    t = await startTestApp({ deps: { webDir: join(root, "web") } });
  });

  afterAll(async () => {
    await t.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("sends a CSP that keeps images same-origin and allows only the hashed inline style", async () => {
    for (const url of ["/", "/api/connections", "/healthz"]) {
      const res = await t.app.inject({ method: "GET", url });
      const csp = res.headers["content-security-policy"];
      expect(typeof csp, url).toBe("string");
      const directives = Object.fromEntries(
        String(csp)
          .split(";")
          .map((d) => d.trim().split(/\s+/))
          .map(([name = "", ...values]) => [name, values]),
      );
      expect(directives["img-src"], url).toEqual(["'self'", "data:"]);
      expect(directives["script-src"], url).toEqual(["'self'"]);
      expect(directives["style-src-elem"], url).toEqual(["'self'", HASH]);
      expect(directives["connect-src"], url).toEqual(["'self'"]);
      expect(directives["upgrade-insecure-requests"], url).toBeUndefined();
      expect(res.headers["strict-transport-security"], url).toBeUndefined();
      expect(res.headers["x-content-type-options"], url).toBe("nosniff");
    }
  });
});
