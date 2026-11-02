import { expect, test, type Page } from "@playwright/test";

const hasHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test.describe("app shell", () => {
  test("header tabs and the status band at every width, with no horizontal scroll", async ({
    page,
  }) => {
    await page.goto("/messages/channel/0");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Messages",
      "Map",
      "Nodes",
      "Settings",
    ]);
    await expect(page.locator("[data-mt=sidebar], [data-mt=menu-button]")).toHaveCount(0);
    const band = page.locator("[data-mt=status-band]");
    await expect(band.locator("[data-mt=status-pill]")).toBeVisible();
    // FakeNode's config: US LongFast → 906.875 MHz (CR-005 K1).
    await expect(band.locator("[data-mt=status-cell][data-mt-variant=freq] dd")).toHaveText(
      "906.875 MHz",
    );
    await expect(band.locator("[data-mt=status-cell][data-mt-variant=preset] dd")).toContainText(
      "LongFast",
    );
    expect(await hasHorizontalScroll(page)).toBe(false);

    // Below 768 px the tabs have their own row under the brand and actions.
    const width = page.viewportSize()?.width ?? 0;
    const header = await page.locator("[data-mt=header-actions]").boundingBox();
    const tabs = await nav.boundingBox();
    if (!header || !tabs) throw new Error("no layout");
    if (width < 768) expect(tabs.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    else
      expect(Math.abs(tabs.y - (header.y + header.height / 2 - tabs.height / 2))).toBeLessThan(12);
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

  test("navigates between sections with the tabs", async ({ page }) => {
    await page.goto("/messages/channel/0");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("link", { name: "Nodes" }).click();
    await expect(page).toHaveURL(/\/nodes$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nodes");
    await expect(nav.getByRole("link", { name: "Nodes" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Messages" }).click();
    await expect(page).toHaveURL(/\/messages(\/channel\/\d)?$/);
    await expect(nav.getByRole("link", { name: "Messages" })).toHaveAttribute(
      "data-mt-state",
      "active",
    );
  });

  test("the station pill opens my node's details", async ({ page }) => {
    await page.goto("/messages/channel/0");
    await page.getByRole("button", { name: /^My node: .+\. Show details$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/[?&]node=(!|%21)[0-9a-f]{8}/);
  });
});
