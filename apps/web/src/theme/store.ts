import { create } from "zustand";
import { readSavedTheme, type ModePref } from "./theme.js";

interface ThemeState {
  /** The user's pick in this browser; null follows the server default. */
  chosenId: string | null;
  /** Shown for now (hover or focus in the picker), not saved. */
  previewId: string | null;
  modePref: ModePref;
  choose: (id: string) => void;
  preview: (id: string | null) => void;
  setModePref: (mode: ModePref) => void;
}

const saved = readSavedTheme();

/** Theme choices in this browser (CR-004 §4.5–4.7); ThemeRuntime applies them. */
export const useThemeStore = create<ThemeState>()((set) => ({
  chosenId: saved?.chosen ? saved.id : null,
  previewId: null,
  modePref: saved?.mode ?? "system",
  choose: (chosenId) => {
    set({ chosenId, previewId: null });
  },
  preview: (previewId) => {
    set({ previewId });
  },
  setModePref: (modePref) => {
    set({ modePref });
  },
}));
