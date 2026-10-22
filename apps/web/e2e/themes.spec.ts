// Themes (CR-004 Phase A): live switching without a reload, no flash of Default, the
// mode, `?theme=`, the server default and hot reload. Against the `theme` instance
// (its /data/themes holds the test-only `contrast` theme and is writable from here),
// plus the dashboard and history instances for the map and charts (only this browser's
// theme changes there; nothing on those servers is touched).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { controlClient, ME, RIDGE, socketSubscribed } from "./control.js";
import {
  DASHBOARD_PORT,
  HISTORY_PORT,
  THEME_CONTROL_PORT,
  THEME_DATA_DIR,
  THEME_PORT,
} from "./ports.js";

const BASE = `http://127.0.0.1:${THEME_PORT}`;
const node = controlClient(THEME_CONTROL_PORT);
const USER_THEMES = join(THEME_DATA_DIR, "themes");
const CONTRAST_BG = "rgb(42, 13, 46)";
const DEFAULT_DARK_BG = "rgb(11, 16, 24)";
const DEFAULT_LIGHT_BG = "rgb(244, 246, 249)";

test.beforeEach(({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, "theme switching once, on desktop");
});

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function openAppearance(page: Page): Promise<void> {
  await page.goto(`${BASE}/settings/appearance`);
  await expect(page.locator("[data-mt=theme-card]").first()).toBeVisible();
}

const card = (page: Page, name: RegExp) => page.getByRole("radio", { name });

/**
 * A canvas's own pixels (not the page behind it), to tell whether it was redrawn in
 * other colors; "" while it's being replaced.
 */
const pixels = async (canvas: Locator) => {
  try {
    return await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL(), undefined, {
      timeout: 1_000,
    });
  } catch {
    return "";
  }
};

test("picking a theme restyles the page at once and survives a reload with no flash", async ({
  page,
}) => {
  await openAppearance(page);
  expect(await bodyBg(page)).toBe(DEFAULT_DARK_BG);
  await card(page, /Contrast \(test\)/).click();
  await expect.poll(() => bodyBg(page)).toBe(CONTRAST_BG);
  await expect(card(page, /Contrast \(test\)/)).toHaveAttribute("data-mt-state", "active");
  const saved = await page.evaluate(() => localStorage.getItem("meshterm.theme"));
  expect(JSON.parse(saved ?? "{}")).toMatchObject({ id: "contrast", chosen: true });

  // Without the app's JavaScript only the boot script runs: if the page is already in
  // the contrast colors, the first paint was too (no flash of Default).
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.reload();
  expect(await bodyBg(page)).toBe(CONTRAST_BG);
  expect(await page.evaluate(() => document.documentElement.dataset.mtTheme)).toBe("contrast");
  await page.unroute("**/assets/*.js");

  // Back to Default for the other tests.
  await openAppearance(page);
  await card(page, /^Default/).click();
  await expect.poll(() => bodyBg(page)).toBe(DEFAULT_DARK_BG);
});

test("hovering a card previews it; leaving puts the chosen theme back", async ({ page }) => {
  await openAppearance(page);
  await card(page, /Contrast \(test\)/).hover();
  await expect.poll(() => bodyBg(page)).toBe(CONTRAST_BG);
  await page.locator("[data-mt=settings-title]").hover();
  await expect.poll(() => bodyBg(page)).toBe(DEFAULT_DARK_BG);
  const saved = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("meshterm.theme"))) ?? "{}",
  ) as { id?: string };
  expect(saved.id).toBe("default");
});

test("Default follows System live, and Light / Dark override it", async ({ page }) => {
  await openAppearance(page);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => bodyBg(page)).toBe(DEFAULT_LIGHT_BG);
  expect(await page.evaluate(() => document.documentElement.dataset.mtMode)).toBe("light");
  await page.getByRole("button", { name: "Dark" }).click();
  await expect.poll(() => bodyBg(page)).toBe(DEFAULT_DARK_BG);
  await page.getByRole("button", { name: "System" }).click();
  await expect.poll(() => bodyBg(page)).toBe(DEFAULT_LIGHT_BG);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => bodyBg(page)).toBe(DEFAULT_DARK_BG);
});

test("?theme= forces a theme for one load without saving it", async ({ page }) => {
  await page.goto(`${BASE}/dashboard?theme=contrast`);
  await expect(page.locator("[data-mt=app-shell]")).toBeVisible();
  expect(await bodyBg(page)).toBe(CONTRAST_BG);
  await page.goto(`${BASE}/dashboard`);
  await expect(page.locator("[data-mt=app-shell]")).toBeVisible();
  await expect.poll(() => bodyBg(page)).toBe(DEFAULT_DARK_BG);
});

test("the server default applies to browsers that haven't picked a theme", async ({
  page,
  browser,
}) => {
  const put = (id: string) => page.request.put(`${BASE}/api/themes/default`, { data: { id } });
  expect((await put("contrast")).ok()).toBe(true);
  try {
    const fresh = await browser.newPage();
    await fresh.goto(`${BASE}/dashboard`);
    await expect.poll(() => bodyBg(fresh)).toBe(CONTRAST_BG);
    await fresh.close();
  } finally {
    await put("default");
  }
});

test("a theme dropped into /data/themes appears, and editing it restyles open pages", async ({
  page,
}) => {
  const dir = join(USER_THEMES, "dropped");
  rmSync(dir, { recursive: true, force: true });
  await openAppearance(page);
  mkdirSync(dir, { recursive: true });
  const manifest = JSON.parse(
    readFileSync(new URL("./fixtures/themes/contrast/theme.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  writeFileSync(
    join(dir, "theme.json"),
    JSON.stringify({ ...manifest, id: "dropped", name: "Dropped in" }),
  );
  writeFileSync(join(dir, "theme.css"), "@layer theme { :root { --mt-surface-bg: #003300; } }");
  try {
    // Within 2 s of the files landing (CR-004 §4.8), without a reload.
    await expect(card(page, /Dropped in/)).toBeVisible({ timeout: 2_500 });
    await card(page, /Dropped in/).click();
    await expect.poll(() => bodyBg(page)).toBe("rgb(0, 51, 0)");
    writeFileSync(join(dir, "theme.css"), "@layer theme { :root { --mt-surface-bg: #000066; } }");
    await expect.poll(() => bodyBg(page), { timeout: 5_000 }).toBe("rgb(0, 0, 102)");
    // Removing the active theme falls back to the server default.
    rmSync(dir, { recursive: true, force: true });
    await expect.poll(() => bodyBg(page), { timeout: 5_000 }).toBe(DEFAULT_DARK_BG);
    await expect(card(page, /Dropped in/)).toHaveCount(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("canvas and code-drawn colors follow a switch without a reload", async ({ page }) => {
  // The favicon badge: an unread DM, then a switch redraws it in the new badge color.
  const subscribed = socketSubscribed(page);
  await page.goto(`${BASE}/dashboard`);
  await subscribed;
  await node.injectText(RIDGE, { to: ME }, "theme test dm");
  const icon = () =>
    page.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? "");
  await expect.poll(icon).toMatch(/^data:image\/png/);
  const before = await icon();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(icon).not.toBe(before);
  await page.emulateMedia({ colorScheme: "dark" });

  // Map dots (MapLibre paint properties) and node-card sparklines.
  await page.goto(`http://127.0.0.1:${DASHBOARD_PORT}/map`);
  await expect(page.locator("[data-mt=map-view]")).toHaveAttribute("data-mt-state", "ready", {
    timeout: 15_000,
  });
  const dotColor = () =>
    page.evaluate(
      `JSON.stringify(window.__meshtermMap.getPaintProperty("mt-nodes", "circle-color"))`,
    );
  const darkDots = await dotColor();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(dotColor).not.toBe(darkDots);
  await page.emulateMedia({ colorScheme: "dark" });

  await page.goto(`http://127.0.0.1:${HISTORY_PORT}/nodes`);
  const spark = page.locator("[data-mt=sparkline]").first();
  await expect(spark).toBeVisible();
  const stroke = () => spark.evaluate((el) => getComputedStyle(el).color);
  const darkStroke = await stroke();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(stroke).not.toBe(darkStroke);
  await page.emulateMedia({ colorScheme: "dark" });

  // Telemetry charts (uPlot canvases) in the node drawer.
  await page.goto(`http://127.0.0.1:${HISTORY_PORT}/nodes?node=!5e6f7081`);
  const dialog = page.getByRole("dialog", { name: "Garage Station" });
  await dialog.getByRole("tab", { name: "Telemetry" }).click();
  const chart = dialog.locator('[data-mt=chart-group][data-mt-variant="battery"] canvas').first();
  await expect(chart).toBeVisible();
  await expect.poll(() => pixels(chart)).not.toBe("");
  const darkChart = await pixels(chart);
  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(async () => {
      const now = await pixels(chart);
      return now !== "" && now !== darkChart;
    })
    .toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
});

test("THEMING.md's first-theme walkthrough produces a working theme", async ({ page }) => {
  // The CSS blocks of steps 3 and 4, exactly as the guide shows them.
  const guide = readFileSync(new URL("../../../THEMING.md", import.meta.url), "utf8");
  const walkthrough = guide.slice(
    guide.indexOf("## Your first theme in 10 minutes"),
    guide.indexOf("## How styling works"),
  );
  const blocks = [...walkthrough.matchAll(/```css\n([\s\S]*?)```/g)].map((m) =>
    m[1]?.replace(/^ {3}/gm, ""),
  );
  expect(blocks).toHaveLength(2);
  const [tokens = "", hook = ""] = blocks;
  const css = tokens.replace(/\}\s*$/, `\n${hook}}\n`);
  const dir = join(USER_THEMES, "harbor");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "theme.json"),
    JSON.stringify({
      id: "harbor",
      name: "Harbor",
      version: "1.0.0",
      colorScheme: "dark",
      preview: { bg: "#0d1b24", surface: "#13293a", accent: "#2ec4b6", text: "#e6f1f7" },
    }),
  );
  writeFileSync(join(dir, "theme.css"), css);
  try {
    await openAppearance(page);
    await card(page, /Harbor/).click();
    await expect.poll(() => bodyBg(page)).toBe("rgb(13, 27, 36)");
    const active = page.locator("[data-mt=nav-item][data-mt-state=active]").first();
    await expect(active).toHaveCSS("border-left-color", "rgb(46, 196, 182)");
    await card(page, /^Default/).click();
    await expect.poll(() => bodyBg(page)).toBe(DEFAULT_DARK_BG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
