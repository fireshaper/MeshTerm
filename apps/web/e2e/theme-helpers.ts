// Picking a theme in a test browser the way the picker does (CR-004), and waiting for it.
import { expect, type Page } from "@playwright/test";

/** Picks a theme for this browser before any page loads, as the picker would. */
export async function useTheme(
  page: Page,
  id: string,
  mode: "dark" | "light",
  effects = false,
): Promise<void> {
  await page.emulateMedia({ colorScheme: mode });
  await page.addInitScript(
    ([theme, m, fx]) => {
      localStorage.setItem(
        "meshterm.theme",
        JSON.stringify({
          id: theme,
          hash: "",
          entry: "theme.css",
          scheme: "auto",
          mode: m,
          chosen: true,
          effects: [],
        }),
      );
      localStorage.setItem("meshterm.effects", String(fx));
    },
    [id, mode, effects] as const,
  );
}

/** Waits until the theme's stylesheet (current hash) and fonts are in. */
export async function themeReady(page: Page, id: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (theme) =>
          document.documentElement.dataset.mtTheme === theme &&
          (document.getElementById("mt-theme") as HTMLLinkElement | null)?.href.includes("?v=") ===
            true,
        id,
      ),
    )
    .toBe(true);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
