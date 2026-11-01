import type { ThemeDTO, ThemeManifest } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeEffects,
  applyAccent,
  applyTheme,
  pickTheme,
  readSavedTheme,
  resolveAccent,
  resolveMode,
  saveTheme,
  THEME_APPLIED_EVENT,
  THEME_STORAGE_KEY,
  themeHref,
} from "./theme.js";

const theme = (id: string, extra: Partial<ThemeDTO> = {}): ThemeDTO => ({
  id,
  source: "builtin",
  hash: `h-${id}`,
  valid: true,
  manifest: {
    id,
    name: id,
    version: "1.0.0",
    colorScheme: "auto",
    preview: { bg: "#000", surface: "#111", accent: "#0af", text: "#fff" },
    entry: "theme.css",
  },
  ...extra,
});

describe("pickTheme (CR-004 §4.4)", () => {
  const themes = [theme("default"), theme("retro"), theme("bad", { valid: false, manifest: null })];

  it("takes the first working candidate, then Default", () => {
    expect(pickTheme(themes, [null, "retro", "default"])?.id).toBe("retro");
    expect(pickTheme(themes, ["gone", "bad", undefined])?.id).toBe("default");
    expect(pickTheme([theme("x")], ["gone"])).toBeNull();
  });
});

describe("resolveMode (CR-004 §4.6)", () => {
  it("fixed-scheme themes ignore the setting; auto ones follow it or the system", () => {
    expect(resolveMode("dark", "light", false)).toBe("dark");
    expect(resolveMode("light", "dark", true)).toBe("light");
    expect(resolveMode("auto", "light", true)).toBe("light");
    expect(resolveMode("auto", "system", true)).toBe("dark");
    expect(resolveMode("auto", "system", false)).toBe("light");
  });
});

describe("saved theme", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips and tolerates junk", () => {
    saveTheme({
      id: "retro",
      hash: "abc",
      entry: "theme.css",
      scheme: "dark",
      mode: "light",
      chosen: true,
      effects: [],
      accents: { default: "amber" },
    });
    expect(readSavedTheme()).toMatchObject({
      id: "retro",
      mode: "light",
      chosen: true,
      accents: { default: "amber" },
    });
    localStorage.setItem(THEME_STORAGE_KEY, "{ nope");
    expect(readSavedTheme()).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ id: "x", mode: "purple" }));
    expect(readSavedTheme()).toMatchObject({ id: "x", mode: "system", chosen: false, accents: {} });
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ id: "x", accents: { default: "moss", bad: "<script>", n: 3 } }),
    );
    expect(readSavedTheme()?.accents).toEqual({ default: "moss" });
  });

  it("works without storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => {
      saveTheme({
        id: "a",
        hash: "",
        entry: "theme.css",
        scheme: "auto",
        mode: "system",
        chosen: true,
        effects: [],
        accents: {},
      });
    }).not.toThrow();
    expect(readSavedTheme()).toBeNull();
  });
});

describe("applyTheme (CR-004 §4.5)", () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="color-scheme" content="dark light"><link id="mt-theme" rel="stylesheet" href="/themes/default/theme.css" data-mt="theme-link">';
    document.documentElement.removeAttribute("data-mt-theme");
    document.documentElement.removeAttribute("data-mt-mode");
  });

  it("swaps the stylesheet only after the new one loaded, then announces it", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const load = () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    const applied = vi.fn();
    window.addEventListener(THEME_APPLIED_EVENT, applied);
    const retro = theme("retro", {
      manifest: {
        ...(theme("retro").manifest as ThemeManifest),
        colorScheme: "dark",
        modes: { dark: "dark.css" },
      },
    });
    const done = applyTheme(retro, "dark", load);
    await Promise.resolve();
    // Both links while the new one loads; the old one still styles the page.
    const links = document.querySelectorAll<HTMLLinkElement>('[data-mt="theme-link"]');
    expect(links).toHaveLength(2);
    expect(links[1]?.media).toBe("print");
    finish(true);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-mt="theme-mode-link"]')).toHaveLength(1);
    });
    finish(true);
    expect(await done).toBe(true);
    const link = document.getElementById("mt-theme") as HTMLLinkElement;
    expect(link.getAttribute("href")).toBe(themeHref(retro));
    expect(link.media).toBe("all");
    expect(document.querySelectorAll('[data-mt="theme-link"]')).toHaveLength(1);
    expect(document.getElementById("mt-theme-mode")?.getAttribute("href")).toBe(
      "/themes/retro/dark.css?v=h-retro",
    );
    expect(document.documentElement.dataset.mtTheme).toBe("retro");
    expect(document.documentElement.dataset.mtMode).toBe("dark");
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
      "dark",
    );
    expect(applied).toHaveBeenCalledTimes(1);
    window.removeEventListener(THEME_APPLIED_EVENT, applied);
  });

  it("keeps the old theme when the new stylesheet fails", async () => {
    const ok = await applyTheme(theme("retro"), "dark", () => Promise.resolve(false));
    expect(ok).toBe(false);
    expect(document.getElementById("mt-theme")?.getAttribute("href")).toBe(
      "/themes/default/theme.css",
    );
    expect(document.querySelectorAll('[data-mt="theme-link"]')).toHaveLength(1);
  });

  it("a newer switch wins over one still loading", async () => {
    let slow: (ok: boolean) => void = () => undefined;
    const first = applyTheme(theme("retro"), "dark", () => new Promise((r) => (slow = r)));
    const second = applyTheme(theme("neon"), "dark", () => Promise.resolve(true));
    expect(await second).toBe(true);
    slow(true);
    expect(await first).toBe(false);
    expect(document.documentElement.dataset.mtTheme).toBe("neon");
    const links = document.querySelectorAll('[data-mt="theme-link"]');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/themes/neon/theme.css?v=h-neon");
  });
});

describe("activeEffects (CR-004 §7)", () => {
  const media = { reducedMotion: false, moreContrast: false };
  it("the theme's effects, unless turned off or under more contrast", () => {
    expect(activeEffects(["crt", "scanlines"], true, media)).toEqual(["crt", "scanlines"]);
    expect(activeEffects(["crt", "scanlines"], false, media)).toEqual([]);
    expect(activeEffects(["crt"], true, { ...media, moreContrast: true })).toEqual([]);
  });
  it("reduced motion keeps only effects that don't move", () => {
    expect(
      activeEffects(["scanlines", "flicker", "glow"], true, { ...media, reducedMotion: true }),
    ).toEqual(["scanlines", "glow"]);
  });
});

describe("accents (CR-005 §7)", () => {
  const accents = [
    { id: "orange", name: "Signal orange", preview: "#f08a4b" },
    { id: "amber", name: "Amber", preview: "#e8a33a" },
  ];

  it("resolveAccent: the wanted one if offered, else the first, else none", () => {
    expect(resolveAccent({ accents }, "amber")).toBe("amber");
    expect(resolveAccent({ accents }, "moss")).toBe("orange");
    expect(resolveAccent({ accents }, null)).toBe("orange");
    expect(resolveAccent({}, "amber")).toBeNull();
    expect(resolveAccent(null, "amber")).toBeNull();
  });

  it("applyTheme sets the accent the callback returns, then announces it", async () => {
    const applied = vi.fn();
    window.addEventListener(THEME_APPLIED_EVENT, applied);
    await applyTheme(
      theme("field"),
      "light",
      () => Promise.resolve(true),
      () => "amber",
    );
    expect(document.documentElement.dataset.mtAccent).toBe("amber");
    expect((applied.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      id: "field",
      mode: "light",
      accent: "amber",
    });
    await applyTheme(theme("plain"), "light", () => Promise.resolve(true));
    expect(document.documentElement.hasAttribute("data-mt-accent")).toBe(false);
    window.removeEventListener(THEME_APPLIED_EVENT, applied);
  });

  it("applyAccent changes only the attribute and announces it", () => {
    document.head.innerHTML =
      '<link id="mt-theme" rel="stylesheet" href="/themes/field/theme.css" data-mt="theme-link">';
    const applied = vi.fn();
    window.addEventListener(THEME_APPLIED_EVENT, applied);
    applyAccent("field", "dark", "moss");
    expect(document.documentElement.dataset.mtAccent).toBe("moss");
    expect(document.getElementById("mt-theme")?.getAttribute("href")).toBe(
      "/themes/field/theme.css",
    );
    expect(applied).toHaveBeenCalledTimes(1);
    applyAccent("field", "dark", null);
    expect(document.documentElement.hasAttribute("data-mt-accent")).toBe(false);
    window.removeEventListener(THEME_APPLIED_EVENT, applied);
  });
});
