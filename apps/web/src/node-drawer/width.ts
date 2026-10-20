/** Drawer width on wide screens (CR-001 §5.2): 480 px, resizable 400–800 px, remembered. */
export const DRAWER_WIDTH = { default: 480, min: 400, max: 800, step: 16 } as const;
export const DRAWER_WIDTH_KEY = "meshterm.nodeDrawerWidth";

export const clampWidth = (px: number) =>
  Math.round(Math.min(DRAWER_WIDTH.max, Math.max(DRAWER_WIDTH.min, px)));

/** The remembered width, or null (use the theme's default). Storage may be blocked. */
export function readDrawerWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(DRAWER_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? clampWidth(value) : null;
  } catch {
    return null;
  }
}

export function writeDrawerWidth(px: number): void {
  try {
    localStorage.setItem(DRAWER_WIDTH_KEY, String(clampWidth(px)));
  } catch {
    // Not remembered; fine.
  }
}
