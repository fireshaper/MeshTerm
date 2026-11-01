// Types only: this module is in a chunk loaded before zod-config.ts runs, and importing a
// schema value here would build zod schemas with the JIT on (a CSP eval violation).
import type { ThemeDTO, ThemeManifest } from "@meshterm/shared";

/** `DEFAULT_THEME_ID` from shared, without importing it (see above). */
const DEFAULT_THEME_ID = "default";

/** The per-browser mode setting (CR-004 §4.6); only `auto` themes use it. */
export type ModePref = "system" | "light" | "dark";
export type Mode = "light" | "dark";

/** What the boot script reads before the first paint (public/theme-boot.js). */
export const THEME_STORAGE_KEY = "meshterm.theme";

/** Dispatched on `window` after a theme or mode is applied; canvas renderers re-read tokens. */
export const THEME_APPLIED_EVENT = "theme:applied";
export interface ThemeAppliedDetail {
  id: string;
  mode: Mode;
  /** The theme's accent (CR-005 §7), null for a theme without accents. */
  accent: string | null;
}

export interface SavedTheme {
  id: string;
  hash: string;
  entry: string;
  scheme: ThemeManifest["colorScheme"];
  mode: ModePref;
  /** False: following the server default, which may change. */
  chosen: boolean;
  /** The theme's manifest `effects`, so the boot script can set them before the app loads. */
  effects: string[];
  /** The accent picked per theme id (CR-005 §7); the boot script sets the saved theme's. */
  accents: Record<string, string>;
}

const ACCENT_ID = /^[a-z0-9-]{1,20}$/;

function readAccents(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string" && ACCENT_ID.test(e[1]),
    ),
  );
}

const MODES: readonly ModePref[] = ["system", "light", "dark"];

export function readSavedTheme(): SavedTheme | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw as Partial<SavedTheme>;
    if (typeof s.id !== "string") return null;
    return {
      id: s.id,
      hash: typeof s.hash === "string" ? s.hash : "",
      entry: typeof s.entry === "string" ? s.entry : "theme.css",
      scheme: s.scheme === "dark" || s.scheme === "light" ? s.scheme : "auto",
      mode: MODES.includes(s.mode as ModePref) ? (s.mode as ModePref) : "system",
      chosen: s.chosen === true,
      effects: Array.isArray(s.effects) ? s.effects.filter((e) => typeof e === "string") : [],
      accents: readAccents(s.accents),
    };
  } catch {
    return null;
  }
}

export function saveTheme(saved: SavedTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Private mode or storage off: the theme still applies, it just isn't remembered.
  }
}

/** The per-browser "Enable theme effects" setting (CR-004 §7), on unless turned off. */
export const EFFECTS_STORAGE_KEY = "meshterm.effects";

export function readEffectsEnabled(): boolean {
  try {
    return localStorage.getItem(EFFECTS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveEffectsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(EFFECTS_STORAGE_KEY, String(enabled));
  } catch {
    // Not remembered; still applies now.
  }
}

/** Effects that animate; dropped under prefers-reduced-motion (static ones may stay). */
const ANIMATED_EFFECTS = new Set(["flicker"]);

/**
 * The effects to show (CR-004 §7): the theme's, unless turned off in this browser or
 * under prefers-contrast: more; under reduced motion, only the ones that don't move.
 */
export function activeEffects(
  effects: readonly string[],
  enabled: boolean,
  media: { reducedMotion: boolean; moreContrast: boolean },
): string[] {
  if (!enabled || media.moreContrast) return [];
  return effects.filter((e) => !(media.reducedMotion && ANIMATED_EFFECTS.has(e)));
}

/** `?theme=<id>` for this page load, as the boot script found it (never saved). */
export function forcedThemeId(): string | null {
  const root = document.documentElement;
  return root.hasAttribute("data-mt-theme-forced") ? root.getAttribute("data-mt-theme") : null;
}

/** `?accent=<id>` for this page load, as the boot script found it (never saved). */
export function forcedAccentId(): string | null {
  const root = document.documentElement;
  return root.hasAttribute("data-mt-accent-forced") ? root.getAttribute("data-mt-accent") : null;
}

/** The accent to show: the wanted one when the theme offers it, else its first, else none. */
export function resolveAccent(
  manifest: Pick<ThemeManifest, "accents"> | null | undefined,
  wanted: string | null | undefined,
): string | null {
  const accents = manifest?.accents ?? [];
  if (wanted && accents.some((a) => a.id === wanted)) return wanted;
  return accents[0]?.id ?? null;
}

function setAccentAttribute(accent: string | null): void {
  const root = document.documentElement;
  if (accent) root.setAttribute("data-mt-accent", accent);
  else root.removeAttribute("data-mt-accent");
}

/**
 * Switches the accent of the theme already applied: `data-mt-accent` on `<html>`, then
 * `theme:applied` so canvas renderers re-read their tokens. No stylesheet changes.
 */
export function applyAccent(themeId: string, mode: Mode, accent: string | null): void {
  setAccentAttribute(accent);
  window.dispatchEvent(
    new CustomEvent<ThemeAppliedDetail>(THEME_APPLIED_EVENT, {
      detail: { id: themeId, mode, accent },
    }),
  );
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Fixed-scheme themes ignore the setting; `auto` ones follow it (System: the OS). */
export function resolveMode(
  scheme: ThemeManifest["colorScheme"],
  pref: ModePref,
  systemDark: boolean,
): Mode {
  if (scheme !== "auto") return scheme;
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/**
 * Which theme to show: the forced one, a preview, the user's choice, the server
 * default, then Default, whichever first is a working theme (CR-004 §4.4).
 */
export function pickTheme(
  themes: readonly ThemeDTO[],
  candidates: readonly (string | null | undefined)[],
): ThemeDTO | null {
  for (const id of [...candidates, DEFAULT_THEME_ID]) {
    const theme = id ? themes.find((t) => t.id === id && t.valid && t.manifest) : undefined;
    if (theme) return theme;
  }
  return null;
}

const base = (t: ThemeDTO) => `/themes/${t.id}/`;
const versioned = (t: ThemeDTO, file: string) => `${base(t)}${file}?v=${t.hash}`;

export const themeHref = (t: ThemeDTO) => versioned(t, t.manifest?.entry ?? "theme.css");

/** Loads a stylesheet link; resolves false when it fails. Injectable for tests (jsdom). */
export type StylesheetLoader = (link: HTMLLinkElement) => Promise<boolean>;

const LOAD_TIMEOUT_MS = 10_000;
const defaultLoader: StylesheetLoader = (link) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, LOAD_TIMEOUT_MS);
    link.addEventListener("load", () => {
      clearTimeout(timer);
      resolve(true);
    });
    link.addEventListener("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

/**
 * Puts `href` in the place of the link with `id`, without a moment unstyled: the new
 * link loads as `media="print"` next to the old one, then takes over (CR-004 §4.5).
 * With `href` null the link is removed.
 */
async function swapLink(
  id: string,
  hook: string,
  href: string | null,
  load: StylesheetLoader,
  /** True once a newer switch started: this one backs out. */
  stale: () => boolean,
): Promise<boolean> {
  const current = document.getElementById(id) as HTMLLinkElement | null;
  if (href === null) {
    current?.remove();
    return true;
  }
  if (current?.getAttribute("href") === href) return true;
  const next = document.createElement("link");
  next.rel = "stylesheet";
  next.media = "print";
  next.dataset.mt = hook;
  const loaded = load(next);
  next.href = href;
  if (current) current.after(next);
  else document.head.append(next);
  if (!(await loaded) || stale()) {
    next.remove();
    return false;
  }
  next.media = "all";
  current?.remove();
  next.id = id;
  return true;
}

/** Font faces the current theme added, so the next one can take them away. */
let themeFonts: FontFace[] = [];

async function swapFonts(theme: ThemeDTO): Promise<void> {
  if (typeof FontFace !== "function" || !("fonts" in document)) return;
  for (const face of themeFonts) document.fonts.delete(face);
  themeFonts = (theme.manifest?.fonts ?? []).map(
    (f) =>
      new FontFace(f.family, `url("${versioned(theme, f.src)}")`, {
        ...(f.weight ? { weight: f.weight } : {}),
        ...(f.style ? { style: f.style } : {}),
      }),
  );
  for (const face of themeFonts) document.fonts.add(face);
  // Wait briefly so text doesn't jump; a slow or broken font shows the fallback.
  await Promise.race([
    Promise.allSettled(themeFonts.map((f) => f.load())),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

let applying = 0;

/**
 * Applies a theme and mode: stylesheet, mode stylesheet, fonts, `data-mt-theme` /
 * `data-mt-mode` / `data-mt-accent` on `<html>`, the color-scheme meta, then `theme:applied`. A newer call
 * wins over one still loading. Resolves false when the stylesheet failed to load (the
 * previous theme stays).
 */
export async function applyTheme(
  theme: ThemeDTO,
  mode: Mode,
  load: StylesheetLoader = defaultLoader,
  /** Read when the theme is in place, so an accent picked while it loaded wins. */
  accent: () => string | null = () => null,
): Promise<boolean> {
  const run = ++applying;
  const stale = () => run !== applying;
  const manifest = theme.manifest;
  const modeCss = manifest?.modes?.[mode];
  const [main] = await Promise.all([
    swapLink("mt-theme", "theme-link", themeHref(theme), load, stale),
    swapFonts(theme),
  ]);
  if (stale() || !main) return false;
  await swapLink(
    "mt-theme-mode",
    "theme-mode-link",
    modeCss ? versioned(theme, modeCss) : null,
    load,
    stale,
  );
  if (stale()) return false;
  const root = document.documentElement;
  root.setAttribute("data-mt-theme", theme.id);
  root.setAttribute("data-mt-mode", mode);
  const chosenAccent = accent();
  setAccentAttribute(chosenAccent);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode);
  window.dispatchEvent(
    new CustomEvent<ThemeAppliedDetail>(THEME_APPLIED_EVENT, {
      detail: { id: theme.id, mode, accent: chosenAccent },
    }),
  );
  return true;
}
