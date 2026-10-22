import type { ServerMessageOf, ThemeDTO, ThemeMapStyle } from "@meshterm/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { miniMapLook } from "../map/map-style.js";
import { useThemeStore } from "./store.js";
import {
  activeEffects,
  applyTheme,
  forcedThemeId,
  pickTheme,
  resolveMode,
  saveTheme,
  type StylesheetLoader,
} from "./theme.js";

/** The theme list; kept fresh by `theme.changed`. */
export function useThemes() {
  return useQuery({
    queryKey: queryKeys.themes,
    queryFn: api.themes,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** The theme in use, not counting a hover preview (what the picker marks as selected). */
export function useActiveTheme(): ThemeDTO | null {
  const { data } = useThemes();
  const chosenId = useThemeStore((s) => s.chosenId);
  const [forced] = useState(forcedThemeId);
  return data ? pickTheme(data.themes, [forced, chosenId, data.defaultId]) : null;
}

/** `theme.changed` (a theme in /data/themes changed): reload the list; the runtime re-applies. */
export function handleThemeChanged(
  qc: QueryClient,
  _message: Omit<ServerMessageOf<"theme.changed">, "type">,
): void {
  void qc.invalidateQueries({ queryKey: queryKeys.themes });
}

/** The server validated it (CR-004 §8.3); this only guards against a stale or odd file. */
function isMapStyle(json: unknown): json is ThemeMapStyle {
  return (
    typeof json === "object" &&
    json !== null &&
    Array.isArray((json as { layers?: unknown }).layers)
  );
}

/** Whether a media query matches, live (`prefers-color-scheme`, `-contrast`, `-reduced-motion`). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const onChange = () => {
      setMatches(list.matches);
    };
    onChange();
    list.addEventListener("change", onChange);
    return () => {
      list.removeEventListener("change", onChange);
    };
  }, [query]);
  return matches;
}

/** The media that turn effects down (CR-004 §7). */
export function useEffectMedia() {
  return {
    reducedMotion: useMediaQuery("(prefers-reduced-motion: reduce)"),
    moreContrast: useMediaQuery("(prefers-contrast: more)"),
  };
}

/**
 * Keeps the page's theme in line with the list, this browser's choice, a preview and the
 * mode (CR-004 §4.4–4.6). Mounted once, outside the sign-in gate: the sign-in page is
 * themed too. Renders nothing.
 */
export function ThemeRuntime({ load }: { load?: StylesheetLoader }) {
  const { data } = useThemes();
  const chosenId = useThemeStore((s) => s.chosenId);
  const previewId = useThemeStore((s) => s.previewId);
  const modePref = useThemeStore((s) => s.modePref);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const effectsEnabled = useThemeStore((s) => s.effectsEnabled);
  const media = useEffectMedia();
  const [forced] = useState(forcedThemeId);

  const theme = data ? pickTheme(data.themes, [forced, previewId, chosenId, data.defaultId]) : null;
  const scheme = theme?.manifest?.colorScheme ?? "auto";
  const mode = resolveMode(scheme, modePref, systemDark);
  const persist = theme !== null && forced === null && previewId === null;

  useEffect(() => {
    if (!theme) return;
    let cancelled = false;
    void applyTheme(theme, mode, load).then((ok) => {
      if (cancelled || !ok || !persist) return;
      saveTheme({
        id: theme.id,
        hash: theme.hash,
        entry: theme.manifest?.entry ?? "theme.css",
        scheme,
        mode: modePref,
        chosen: chosenId === theme.id,
        effects: [...(theme.manifest?.effects ?? [])],
      });
    });
    return () => {
      cancelled = true;
    };
    // The theme object changes with every list refetch; its id and hash are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme?.id, theme?.hash, mode, persist, modePref, chosenId, scheme, load]);

  // The theme's base-map style (CR-004 §8.3): for the map page, and as CSS for mini maps.
  const mapStyleFile = theme?.manifest?.mapStyle ?? null;
  const themeId = theme?.id ?? null;
  const themeHash = theme?.hash ?? null;
  useEffect(() => {
    let cancelled = false;
    const use = (style: ThemeMapStyle | null) => {
      if (cancelled) return;
      useThemeStore.getState().setMapStyle(style);
      const look = miniMapLook(style);
      const root = document.documentElement.style;
      root.setProperty("--mt-map-tiles-filter", look.filter);
      if (look.background) root.setProperty("--mt-map-tiles-bg", look.background);
      else root.removeProperty("--mt-map-tiles-bg");
    };
    if (!themeId || !mapStyleFile) {
      use(null);
      return;
    }
    fetch(`/themes/${themeId}/${mapStyleFile}?v=${themeHash ?? ""}`)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
      .then((json) => {
        use(isMapStyle(json) ? json : null);
      })
      .catch(() => {
        use(null);
      });
    return () => {
      cancelled = true;
    };
  }, [themeId, themeHash, mapStyleFile]);

  // Effects (CR-004 §7): html[data-mt-fx~="scanlines"] and so on, for the theme's CSS.
  const fx = activeEffects(theme?.manifest?.effects ?? [], effectsEnabled, media).join(" ");
  useEffect(() => {
    const root = document.documentElement;
    if (fx) root.setAttribute("data-mt-fx", fx);
    else root.removeAttribute("data-mt-fx");
  }, [fx]);

  return null;
}
