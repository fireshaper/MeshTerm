import { expect, test, type Page } from "@playwright/test";

const SIDEBAR_MIN_WIDTH = 768;

const hasHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test.describe("app shell", () => {
  test("shows the tab bar below 768 px and the sidebar from 768 px, with no horizontal scroll", async ({
    page,
  }) => {
    await page.goto("/channels/0");
    const width = page.viewportSize()?.width ?? 0;
    const sidebar = page.locator("[data-mt=sidebar]");
    const tabBar = page.locator("[data-mt=tab-bar]");

    if (width < SIDEBAR_MIN_WIDTH) {
      await expect(tabBar).toBeVisible();
      await expect(sidebar).toBeHidden();
    } else {
      await expect(sidebar).toBeVisible();
      await expect(tabBar).toBeHidden();
    }
    await expect(page.locator("[data-mt=header] [data-mt=status-pill]")).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  for (const [path, title] of [
    ["/channels/0", "Channel 0"],
    ["/channels/1", "Channel 1"],
    ["/nodes", "Nodes"],
    ["/dm/195939070", "Direct messages with Ridge Repeater"],
  ] as const) {
    test(`renders ${path} on a direct load, without horizontal scroll`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }

  test("/ redirects to the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("navigates between sections with the visible navigation", async ({ page }) => {
    await page.goto("/channels/0");
    // Only one of the two navs is visible at any width.
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toHaveCount(1);

    await nav.getByRole("link", { name: "Nodes" }).click();
    await expect(page).toHaveURL(/\/nodes$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nodes");
    await expect(nav.getByRole("link", { name: "Nodes" })).toHaveAttribute(
      "data-mt-state",
      "active",
    );

    await nav.getByRole("link", { name: "Channels" }).click();
    await expect(page).toHaveURL(/\/channels\/0$/);
  });
});
