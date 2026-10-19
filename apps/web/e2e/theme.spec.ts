import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const DEFAULT_LIGHT_SURFACE_BG = "#fff";

const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.body).getPropertyValue(n).trim(), name);

test.describe("theme layers", () => {
  test("body gets --mt-surface-bg from the Default theme", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-mt=app-shell]")).toBeVisible();
    expect(await token(page, "--mt-surface-bg")).toBe(DEFAULT_LIGHT_SURFACE_BG);
    // The token reaches actual paint, not just the variable.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
  });

  test("a later theme file in @layer theme overrides a token without !important", async ({
    page,
  }) => {
    await page.goto("/");
    const css = readFileSync(
      new URL("./fixtures/themes/override/theme.css", import.meta.url),
      "utf8",
    );
    expect(css).not.toContain("!important");
    await page.addStyleTag({ content: css });
    expect(await token(page, "--mt-surface-bg")).toBe("#123456");
  });

  test("base styles cannot beat the theme layer", async ({ page }) => {
    await page.goto("/");
    // An unlayered-looking rule placed in @layer base, added last, still loses to @layer theme.
    await page.addStyleTag({ content: "@layer base { :root { --mt-surface-bg: #ff0000; } }" });
    expect(await token(page, "--mt-surface-bg")).toBe(DEFAULT_LIGHT_SURFACE_BG);
  });
});
