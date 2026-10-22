import { expect, test } from "@playwright/test";
import { DASHBOARD_PORT, HISTORY_PORT } from "./ports.js";

// Every screen loads under the server's Content Security Policy without violations.
test("no Content Security Policy violations on any screen", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  const response = await page.goto("/messages/channel/0");
  expect(response?.headers()["content-security-policy"]).toContain("img-src 'self' data:");
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute("data-mt-state", "connected");
  for (const path of [
    "/nodes",
    "/messages/dm/!0badcafe",
    "/messages/channel/1",
    "/dashboard",
    "/settings/appearance",
    // The map page (MapLibre: module worker, canvas, tiles through the proxy).
    `http://127.0.0.1:${DASHBOARD_PORT}/map`,
    // The dashboard with mini maps (tiles through the proxy).
    `http://127.0.0.1:${DASHBOARD_PORT}/dashboard`,
  ]) {
    await page.goto(path);
    // Pages show a title (threads their own); the map page shows the map.
    await expect(
      page
        .locator(
          "[data-mt=page-title], [data-mt=thread-title], [data-mt=map-view][data-mt-state=ready]",
        )
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
  }
  // The drawer's charts (uPlot: canvas, CSSOM styles) on the history instance.
  await page.goto(`http://127.0.0.1:${HISTORY_PORT}/nodes?node=!5e6f7081`);
  await page.getByRole("dialog").getByRole("tab", { name: "Telemetry" }).click();
  await expect(page.locator("[data-mt=chart-group] canvas").first()).toBeVisible();
  await page.getByRole("dialog").getByRole("tab", { name: "Signal" }).click();
  await expect(page.locator("[data-mt=chart-group] canvas").first()).toBeVisible();
  // The layer-order <style> was allowed by hash: the theme still wins over base.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(11, 16, 24)");
  expect(violations).toEqual([]);
});
