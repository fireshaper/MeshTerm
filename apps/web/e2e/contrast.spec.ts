// Text contrast per theme (CR-004 §9): axe-core's color-contrast rule (WCAG AA) on the
// main screens in every built-in theme and mode. Effects are off: they're checked by
// keeping them faint (THEMING.md), and the overlay isn't text.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { HISTORY_PORT } from "./ports.js";
import { themeReady, useTheme } from "./theme-helpers.js";

const THEMES = [
  { id: "default", mode: "dark" },
  { id: "default", mode: "light" },
  { id: "retro-terminal", mode: "dark" },
  { id: "retro-terminal-amber", mode: "dark" },
  { id: "cyberpunk", mode: "dark" },
] as const;

const H = `http://127.0.0.1:${HISTORY_PORT}`;
const SCREENS: [string, string][] = [
  ["dashboard", `${H}/dashboard`],
  ["nodes", `${H}/nodes`],
  ["node table", `${H}/nodes?view=table`],
  ["node drawer", `${H}/nodes?node=!5e6f7081`],
  ["channel", "/messages/channel/0"],
  ["DM", "/messages/dm/!0badcafe"],
  ["device settings", "/settings/device"],
  ["notification settings", "/settings/notifications"],
  ["appearance", "/settings/appearance"],
];

for (const { id, mode } of THEMES) {
  test(`text contrast meets WCAG AA: ${id} (${mode})`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, "once per theme, on desktop");
    test.setTimeout(120_000);
    await useTheme(page, id, mode);
    const problems: string[] = [];
    for (const [screen, url] of SCREENS) {
      await page.goto(url);
      await themeReady(page, id);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      for (const v of violations) {
        for (const node of v.nodes) {
          const data = node.any[0]?.data as
            { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
          problems.push(
            `${screen}: ${node.target.join(" ")} — ${data?.fgColor ?? "?"} on ${data?.bgColor ?? "?"} (${data?.contrastRatio ?? "?"}:1)`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });
}
