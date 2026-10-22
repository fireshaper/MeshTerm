import { create } from "zustand";

/**
 * Notification settings of this browser (CR-003 §10, "Browser" scope): a wall display
 * and a laptop want different things, so these live in localStorage, not on the server.
 */
export interface BrowserNotifySettings {
  /** OS notifications (N4); off until the user enables them. */
  desktop: boolean;
  /** OS notifications say "New direct message" instead of the text. */
  hideText: boolean;
  sounds: boolean;
  /** 0–1. */
  volume: number;
  soundTypes: { message: boolean; mention: boolean; channel: boolean };
  /** Flash the tab title while it's in the background. */
  titleFlash: boolean;
  toasts: boolean;
  toastPosition: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

export const DEFAULT_BROWSER_SETTINGS: BrowserNotifySettings = {
  desktop: false,
  hideText: false,
  sounds: true,
  volume: 0.6,
  soundTypes: { message: true, mention: true, channel: true },
  titleFlash: true,
  toasts: true,
  toastPosition: "top-right",
};

export const BROWSER_SETTINGS_KEY = "meshterm.notifications";

function read(): BrowserNotifySettings {
  try {
    const raw = localStorage.getItem(BROWSER_SETTINGS_KEY);
    if (!raw) return DEFAULT_BROWSER_SETTINGS;
    const saved = JSON.parse(raw) as Partial<BrowserNotifySettings>;
    return {
      ...DEFAULT_BROWSER_SETTINGS,
      ...saved,
      soundTypes: { ...DEFAULT_BROWSER_SETTINGS.soundTypes, ...saved.soundTypes },
    };
  } catch {
    return DEFAULT_BROWSER_SETTINGS;
  }
}

interface SettingsState {
  settings: BrowserNotifySettings;
  update: (patch: Partial<BrowserNotifySettings>) => void;
}

export const useBrowserNotifySettings = create<SettingsState>()((set, get) => ({
  settings: read(),
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try {
      localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Not remembered; still applied in this tab.
    }
  },
}));

/** Back to what's stored (or the defaults); for tests. */
export function reloadBrowserNotifySettings(): void {
  useBrowserNotifySettings.setState({ settings: read() });
}
