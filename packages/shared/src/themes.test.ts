import { describe, expect, it } from "vitest";
import { isThemeAssetPath, ThemeManifest } from "./themes.js";

const base = {
  id: "neon",
  name: "Neon",
  version: "1.2.3",
  colorScheme: "dark",
  preview: { bg: "#000", surface: "rgb(10 20 30)", accent: "hotpink", text: "#fff" },
};

describe("ThemeManifest (CR-004 §4.2)", () => {
  it("accepts a minimal manifest and defaults the entry", () => {
    expect(ThemeManifest.parse(base).entry).toBe("theme.css");
  });

  it("accepts every optional field with relative paths", () => {
    const full = ThemeManifest.parse({
      ...base,
      author: "Me",
      description: "Bright",
      modes: { light: "light.css" },
      fonts: [{ family: "Orbitron", src: "fonts/orbitron.woff2", weight: "400 900" }],
      mapStyle: "map-style.json",
      sounds: { message: "sounds/blip.wav" },
      effects: ["glow", "scanlines"],
      minAppVersion: "1.0.0",
    });
    expect(full.fonts?.[0]?.src).toBe("fonts/orbitron.woff2");
  });

  it.each([
    [{ id: "Neon" }, "id"],
    [{ id: "x".repeat(41) }, "id"],
    [{ version: "1.0" }, "version"],
    [{ colorScheme: "dim" }, "colorScheme"],
    [{ preview: { bg: "url(x)", surface: "#000", accent: "#000", text: "#000" } }, "preview"],
    [{ entry: "../default/theme.css" }, "entry"],
    [{ entry: "/etc/theme.css" }, "entry"],
    [{ entry: "https://evil.example/t.css" }, "entry"],
    [{ entry: "theme.js" }, "entry"],
    [{ fonts: [{ family: "X", src: "x.ttf" }] }, "fonts"],
    [{ sounds: { message: "a.css" } }, "sounds"],
    [{ effects: ["sparkles"] }, "effects"],
  ])("refuses %o", (patch, field) => {
    const result = ThemeManifest.safeParse({ ...base, ...patch });
    expect(result.success).toBe(false);
    expect(String(result.error?.issues[0]?.path[0])).toBe(field);
  });
});

describe("isThemeAssetPath", () => {
  it.each([
    ["theme.css", true],
    ["fonts/a b.woff2", true],
    ["a/../b.css", false],
    ["./theme.css", false],
    ["a//b.css", false],
    ["a\\b.css", false],
    ["c:/x.css", false],
    ["x.CSS", true],
    ["x", false],
  ])("%s → %s", (path, ok) => {
    expect(isThemeAssetPath(path, [".css", ".woff2"])).toBe(ok);
  });
});
