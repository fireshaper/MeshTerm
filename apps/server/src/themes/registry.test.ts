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

describe("map-style.json (CR-004 §8.3)", () => {
  const style = (id: string, json: unknown) => {
    theme("user", id, { mapStyle: "map-style.json" });
    writeFileSync(
      join(root, "user", id, "map-style.json"),
      typeof json === "string" ? json : JSON.stringify(json),
    );
  };

  it("accepts background and raster layers; warns about tile URLs and vector layers", () => {
    style("ok", {
      version: 8,
      sources: { base: { type: "raster", tiles: ["https://elsewhere.example/{z}/{x}/{y}.png"] } },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#000" } },
        { id: "tiles", type: "raster", source: "base", paint: { "raster-saturation": -1 } },
        { id: "roads", type: "line", source: "vec" },
      ],
    });
    const [t] = registry().list(true);
    expect(t?.valid).toBe(true);
    expect(t?.warnings).toEqual([
      "map-style.json: tile URLs are ignored; map tiles always come through MeshTerm",
      "map-style.json: vector layers aren't drawn yet (only background and raster)",
    ]);
  });

  it.each([
    ["not JSON", "{ nope", /isn't valid JSON/],
    ["no layers", { version: 8 }, /layers/],
    [
      "an unknown paint property",
      { layers: [{ id: "t", type: "raster", paint: { "raster-resampling": "nearest" } }] },
      /layers/,
    ],
    [
      "an out-of-range value",
      { layers: [{ id: "t", type: "raster", paint: { "raster-opacity": 3 } }] },
      /layers/,
    ],
    [
      "an expression",
      { layers: [{ id: "b", type: "background", paint: { "background-color": ["get", "x"] } }] },
      /layers/,
    ],
  ])("refuses %s", (_name, json, error) => {
    style("bad", json);
    expect(registry().list(true)[0]?.error).toMatch(error);
  });
});

describe("map styles per mode (CR-005)", () => {
  it("checks each mode's file like map-style.json", () => {
    theme("user", "modes", { mapStyleModes: { dark: "dark.json", light: "light.json" } });
    writeFileSync(
      join(root, "user", "modes", "dark.json"),
      JSON.stringify({ layers: [{ id: "bg", type: "background", paint: {} }] }),
    );
    expect(registry().list(true)[0]?.error).toMatch(/names light.json, which isn't in the folder/);
    writeFileSync(join(root, "user", "modes", "light.json"), JSON.stringify({ version: 8 }));
    expect(registry().list(true)[0]?.error).toMatch(/^light.json: layers/);
    writeFileSync(
      join(root, "user", "modes", "light.json"),
      JSON.stringify({ layers: [{ id: "bg", type: "background", paint: {} }] }),
    );
    expect(registry().list(true)[0]?.valid).toBe(true);
  });

  it("the built-in themes load without errors or warnings", () => {
    const builtin = new ThemeRegistry({
      builtinDir: join(import.meta.dirname, "../../../../themes"),
      userDir: join(root, "user"),
    });
    builtin.scanAll();
    for (const t of builtin.list(true)) {
      expect({ id: t.id, error: t.error, warnings: t.warnings }).toEqual({
        id: t.id,
        error: undefined,
        warnings: undefined,
      });
    }
    expect(builtin.get("default")?.manifest?.accents?.map((a) => a.id)).toEqual([
      "orange",
      "amber",
      "moss",
    ]);
    expect(builtin.get("classic")?.manifest?.name).toBe("Classic");
  });
});
