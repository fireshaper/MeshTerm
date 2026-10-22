import type { SoundKind } from "./rules.js";

/**
 * Alert sounds (CR-003 §7). The app ships `message`, `mention` and `channel`; a theme
 * can replace any of them with a `sounds` map in its theme.json (paths relative to the
 * theme). Browsers block audio until the page has been used, so the first click or key
 * press "unlocks" it; a blocked sound fails silently. At most one sound every 2 s.
 */

export const SOUND_KINDS: readonly SoundKind[] = ["message", "mention", "channel"];
export const SOUND_THROTTLE_MS = 2_000;

/** The built-in file for a kind. */
export const defaultSoundUrl = (kind: SoundKind) => `/sounds/${kind}.wav`;

/** The active theme's folder, from the stylesheet link (`/themes/<id>/theme.css`). */
export function themeBase(): string | null {
  const href = document
    .querySelector<HTMLLinkElement>('link[data-mt="theme-link"]')
    ?.getAttribute("href");
  const m = href ? /^(\/themes\/[^/]+\/)/.exec(href) : null;
  return m?.[1] ?? null;
}

/** A theme's sound overrides as URLs; unknown kinds and odd paths are ignored. */
export function themeSoundUrls(
  base: string,
  manifest: unknown,
): Partial<Record<SoundKind, string>> {
  const sounds = (manifest as { sounds?: unknown } | null)?.sounds;
  if (typeof sounds !== "object" || sounds === null) return {};
  const out: Partial<Record<SoundKind, string>> = {};
  for (const kind of SOUND_KINDS) {
    const path = (sounds as Record<string, unknown>)[kind];
    // Files inside the theme folder only.
    if (typeof path === "string" && /^[\w./-]+$/.test(path) && !path.includes("..")) {
      out[kind] = base + path.replace(/^\.\//, "");
    }
  }
  return out;
}

const DEFAULT_URLS: Record<SoundKind, string> = {
  message: defaultSoundUrl("message"),
  mention: defaultSoundUrl("mention"),
  channel: defaultSoundUrl("channel"),
};

export class SoundPlayer {
  private readonly audio = new Map<SoundKind, HTMLAudioElement>();
  private urls: Record<SoundKind, string> = { ...DEFAULT_URLS };
  private lastAt = -Infinity;
  private unlocked = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly makeAudio: (url: string) => HTMLAudioElement = (url) => new Audio(url),
  ) {}

  /** Loads the theme's overrides (if any) and preloads every sound. */
  async load(fetchJson: (url: string) => Promise<unknown> = defaultFetchJson): Promise<void> {
    const base = themeBase();
    const urls = { ...DEFAULT_URLS };
    if (base) {
      try {
        Object.assign(urls, themeSoundUrls(base, await fetchJson(`${base}theme.json`)));
      } catch {
        // No manifest or no sounds: the built-in ones.
      }
    }
    // A theme switch replaces the previous theme's sounds, or goes back to the built-in ones.
    this.urls = urls;
    for (const kind of SOUND_KINDS) this.element(kind);
  }

  urlOf(kind: SoundKind): string {
    return this.urls[kind];
  }

  /** On the first interaction: play-and-pause once so later plays are allowed. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const kind of SOUND_KINDS) {
      const a = this.element(kind);
      a.muted = true;
      safePlay(a).then(
        () => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        },
        () => {
          a.muted = false;
        },
      );
    }
  }

  /** Plays a kind at `volume` (0–1); false when throttled or blocked. */
  play(kind: SoundKind, volume: number): boolean {
    const now = this.now();
    if (now - this.lastAt < SOUND_THROTTLE_MS) return false;
    this.lastAt = now;
    const a = this.element(kind);
    a.volume = Math.max(0, Math.min(1, volume));
    a.currentTime = 0;
    // Autoplay blocked, an old browser, or the file failed: fail silently (CR-003 §7).
    safePlay(a).catch(() => undefined);
    return true;
  }

  private element(kind: SoundKind): HTMLAudioElement {
    let a = this.audio.get(kind);
    if (!a || !a.src.endsWith(this.urls[kind])) {
      a = this.makeAudio(this.urls[kind]);
      a.preload = "auto";
      this.audio.set(kind, a);
    }
    return a;
  }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** `play()` as a promise, even where it throws or returns nothing. */
function safePlay(a: HTMLAudioElement): Promise<void> {
  try {
    return Promise.resolve(a.play());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}
