import { expect, test, type Page } from "@playwright/test";

const SIDEBAR_MIN_WIDTH = 768;

const hasHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test.describe("app shell", () => {
  test("shows a menu button below 768 px and the sidebar from 768 px, with no horizontal scroll", async ({
    page,
  }) => {
    await page.goto("/messages/channel/0");
    const width = page.viewportSize()?.width ?? 0;
    const sidebar = page.locator("[data-mt=sidebar]");
    const menu = page.getByRole("button", { name: "Open navigation" });

    if (width < SIDEBAR_MIN_WIDTH) {
      await expect(menu).toBeVisible();
      await expect(sidebar).toBeHidden();
    } else {
      await expect(sidebar).toBeVisible();
      await expect(menu).toBeHidden();
    }
    await expect(page.locator("[data-mt=header] [data-mt=status-pill]")).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  for (const [path, title] of [
    ["/messages/channel/0", "Messages"],
    ["/messages/channel/1", "Messages"],
    ["/nodes", "Nodes"],
    ["/messages/dm/!0badcafe", "Messages"],
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
    await page.goto("/messages/channel/0");
    const narrow = (page.viewportSize()?.width ?? 0) < SIDEBAR_MIN_WIDTH;
    const nav = page.getByRole("navigation", { name: "Main" });
    /** Below 768 px the navigation lives in the drawer. */
    const go = async (name: string) => {
      if (narrow) await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(nav).toHaveCount(1);
      await nav.getByRole("link", { name }).click();
    };

    await go("Nodes");
    await expect(page).toHaveURL(/\/nodes$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nodes");
    // The drawer closes after choosing a page.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await go("Messages");
    await expect(page).toHaveURL(/\/messages(\/channel\/\d)?$/);
    if (!narrow) {
      await expect(nav.getByRole("link", { name: "Messages" })).toHaveAttribute(
        "data-mt-state",
        "active",
      );
    }
  });

  test("the sidebar collapses to icons and stays collapsed after a reload", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, "the sidebar is expanded from 1024 px");
    await page.goto("/messages/channel/0");
    const label = page.locator("[data-mt=sidebar] [data-mt=nav-label]").first();
    await expect(label).toBeVisible();
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(label).toBeHidden();
    await page.reload();
    await expect(page.locator("[data-mt=app-shell]")).toHaveAttribute("data-mt-state", "collapsed");
    await expect(label).toBeHidden();
  });
});
