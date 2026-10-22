import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeRegistry } from "./registry.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "meshterm-registry-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function theme(dir: string, id: string, manifest: Record<string, unknown> = {}) {
  mkdirSync(join(root, dir, id), { recursive: true });
  writeFileSync(
    join(root, dir, id, "theme.json"),
    JSON.stringify({
      id,
      name: id,
      version: "1.0.0",
      colorScheme: "dark",
      preview: { bg: "#000", surface: "#111", accent: "#0af", text: "#fff" },
      ...manifest,
    }),
  );
  writeFileSync(join(root, dir, id, "theme.css"), "@layer theme {}");
}

const registry = (appVersion?: string) => {
  const r = new ThemeRegistry({
    builtinDir: join(root, "builtin"),
    userDir: join(root, "user"),
    ...(appVersion ? { appVersion } : {}),
  });
  r.scanAll();
  return r;
};

describe("ThemeRegistry", () => {
  it("hides broken themes and problems from viewers", () => {
    theme("builtin", "default");
    theme("user", "bad", { name: "" });
    const r = registry();
    expect(r.list(false).map((t) => t.id)).toEqual(["default"]);
    const admin = r.list(true);
    expect(admin.map((t) => t.id)).toEqual(["default", "bad"]);
    expect(admin[1]?.error).toMatch(/^theme.json: name:/);
  });

  it("refuses a manifest whose id isn't the folder name, or that names missing files", () => {
    theme("user", "one", { id: "two" });
    theme("user", "three", { mapStyle: "map-style.json" });
    theme("user", "Bad_Name");
    const errors = Object.fromEntries(
      registry()
        .list(true)
        .map((t) => [t.id, t.error]),
    );
    expect(errors.one).toMatch(/doesn't match the folder name/);
    expect(errors.three).toMatch(/names map-style.json, which isn't in the folder/);
    expect(errors.Bad_Name).toMatch(/isn't a valid theme id/);
  });

  it("warns when a theme needs a newer MeshTerm", () => {
    theme("user", "future", { minAppVersion: "9.0.0" });
    expect(registry("1.2.0").list(true)[0]?.warnings).toEqual([
      "made for MeshTerm 9.0.0 or later (this is 1.2.0)",
    ]);
    expect(registry().list(true)[0]?.warnings).toBeUndefined();
  });

  it("hashes only served files", () => {
    theme("user", "h");
    const before = registry().get("h")?.hash;
    writeFileSync(join(root, "user", "h", "notes.txt"), "not served");
    expect(registry().get("h")?.hash).toBe(before);
    writeFileSync(join(root, "user", "h", "extra.css"), "x");
    expect(registry().get("h")?.hash).not.toBe(before);
  });
});
