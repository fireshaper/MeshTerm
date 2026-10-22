import type { ServerMessageOf, ThemeDTO } from "@meshterm/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { useThemeStore } from "./store.js";
import {
  applyTheme,
  forcedThemeId,
  pickTheme,
  resolveMode,
  saveTheme,
  systemPrefersDark,
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

/** Tracks `prefers-color-scheme` live (CR-004 §4.6). */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(systemPrefersDark);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setDark(query.matches);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);
  return dark;
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
  const systemDark = useSystemDark();
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
      });
    });
    return () => {
      cancelled = true;
    };
    // The theme object changes with every list refetch; its id and hash are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme?.id, theme?.hash, mode, persist, modePref, chosenId, scheme, load]);

  return null;
}
