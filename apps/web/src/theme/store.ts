import { create } from "zustand";
import { readEffectsEnabled, readSavedTheme, saveEffectsEnabled, type ModePref } from "./theme.js";

interface ThemeState {
  /** The user's pick in this browser; null follows the server default. */
  chosenId: string | null;
  /** Shown for now (hover or focus in the picker), not saved. */
  previewId: string | null;
  modePref: ModePref;
  /** "Enable theme effects" in this browser (saved as `meshterm.effects`). */
  effectsEnabled: boolean;
  choose: (id: string) => void;
  preview: (id: string | null) => void;
  setModePref: (mode: ModePref) => void;
  setEffectsEnabled: (enabled: boolean) => void;
}

const saved = readSavedTheme();

/** Theme choices in this browser (CR-004 §4.5–4.7); ThemeRuntime applies them. */
export const useThemeStore = create<ThemeState>()((set) => ({
  chosenId: saved?.chosen ? saved.id : null,
  previewId: null,
  modePref: saved?.mode ?? "system",
  effectsEnabled: readEffectsEnabled(),
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
}));
