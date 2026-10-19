import { expect, test } from "@playwright/test";
import { RIDGE } from "./control.js";
import { DASHBOARD_PORT } from "./ports.js";

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

  const response = await page.goto("/channels/0");
  expect(response?.headers()["content-security-policy"]).toContain("img-src 'self' data:");
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute("data-mt-state", "connected");
  for (const path of [
    "/nodes",
    `/dm/${RIDGE}`,
    "/channels/1",
    "/dashboard",
    // The dashboard with mini maps (tiles through the proxy).
    `http://127.0.0.1:${DASHBOARD_PORT}/dashboard`,
  ]) {
    await page.goto(path);
    await expect(page.locator("[data-mt=page-title]")).toBeVisible();
  }
  // The layer-order <style> was allowed by hash: the theme still wins over base.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
  expect(violations).toEqual([]);
});
