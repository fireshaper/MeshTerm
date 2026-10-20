import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSP_NONCE_PLACEHOLDER, cspDirectives, inlineStyleHashes } from "./security.js";
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
      `<!doctype html><style>${STYLE}</style><meta name="mt-csp-nonce" content="${CSP_NONCE_PLACEHOLDER}"><div id="root"></div>`,
    );
    t = await startTestApp({ deps: { webDir: join(root, "web") } });
  });

  afterAll(async () => {
    await t.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("sends a CSP that keeps images same-origin and allows the hashed style and this response's nonce", async () => {
    const nonces = new Set<string>();
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
      const elem = directives["style-src-elem"] ?? [];
      expect(elem.slice(0, 2), url).toEqual(["'self'", HASH]);
      expect(elem[2], url).toMatch(/^'nonce-[A-Za-z0-9+/]{22}==' *$/);
      nonces.add(elem[2] ?? "");
      expect(directives["connect-src"], url).toEqual(["'self'"]);
      expect(directives["upgrade-insecure-requests"], url).toBeUndefined();
      expect(res.headers["strict-transport-security"], url).toBeUndefined();
      expect(res.headers["x-content-type-options"], url).toBe("nosniff");
      if (url === "/") {
        // index.html carries the same nonce, for styles libraries insert at runtime.
        const nonce = /'nonce-([^']+)'/.exec(elem[2] ?? "")?.[1] ?? "missing";
        expect(res.body).toContain(`<meta name="mt-csp-nonce" content="${nonce}">`);
        expect(res.body).not.toContain(CSP_NONCE_PLACEHOLDER);
      }
    }
    // A fresh nonce per response.
    expect(nonces.size).toBe(3);
  });

  it("serves the nonced index.html for client routes and /index.html too", async () => {
    for (const url of ["/dashboard", "/index.html"]) {
      const res = await t.app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"], url).toContain("text/html");
      expect(res.body, url).not.toContain(CSP_NONCE_PLACEHOLDER);
    }
  });
});
