import type { ThemeMapStyle } from "@meshterm/shared";
import { create } from "zustand";
import {
  readEffectsEnabled,
  readSavedTheme,
  saveEffectsEnabled,
  saveTheme,
  type ModePref,
} from "./theme.js";

interface ThemeState {
  /** The user's pick in this browser; null follows the server default. */
  chosenId: string | null;
  /** Shown for now (hover or focus in the picker), not saved. */
  previewId: string | null;
  modePref: ModePref;
  /** "Enable theme effects" in this browser (saved as `meshterm.effects`). */
  effectsEnabled: boolean;
  /** The active theme's `map-style.json` (CR-004 §8.3), null for the plain map. */
  mapStyle: ThemeMapStyle | null;
  /** The accent picked per theme id (CR-005 §7); a theme not listed uses its first. */
  accents: Record<string, string>;
  choose: (id: string) => void;
  preview: (id: string | null) => void;
  setModePref: (mode: ModePref) => void;
  setEffectsEnabled: (enabled: boolean) => void;
  setMapStyle: (style: ThemeMapStyle | null) => void;
  setAccent: (themeId: string, accent: string) => void;
}

const saved = readSavedTheme();

/** Theme choices in this browser (CR-004 §4.5–4.7); ThemeRuntime applies them. */
export const useThemeStore = create<ThemeState>()((set) => ({
  chosenId: saved?.chosen ? saved.id : null,
  previewId: null,
  modePref: saved?.mode ?? "system",
  effectsEnabled: readEffectsEnabled(),
  mapStyle: null,
  accents: saved?.accents ?? {},
  choose: (chosenId) => {
    set({ chosenId, previewId: null });
  },
  preview: (previewId) => {
    set({ previewId });
  },
  setModePref: (modePref) => {
    set({ modePref });
  },
  setEffectsEnabled: (effectsEnabled) => {
    saveEffectsEnabled(effectsEnabled);
    set({ effectsEnabled });
  },
  setMapStyle: (mapStyle) => {
    set({ mapStyle });
  },
  setAccent: (themeId, accent) => {
    set((s) => {
      const accents = { ...s.accents, [themeId]: accent };
      // Saved right away (the boot script reads it); the rest of the record stays as it is.
      const current = readSavedTheme();
      if (current) saveTheme({ ...current, accents });
      return { accents };
    });
  },
}));
