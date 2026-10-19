import { expect, test } from "@playwright/test";
import { fakeNode } from "./control.js";

test.describe("live connection state", () => {
  test("the status pill follows a node reboot: reconnecting, then connected", async ({ page }) => {
    await page.goto("/channels/0");
    const pill = page.locator("[data-mt=status-pill]");
    await expect(pill).toHaveAttribute("data-mt-state", "connected");
    await expect(pill).toHaveText("Connected");
    await expect(page.locator("[data-mt=socket-indicator]")).toHaveCount(0);

    await fakeNode.reboot(3000);
    await expect(pill).toHaveAttribute("data-mt-state", "reconnecting", { timeout: 5_000 });
    await expect(pill).toHaveText("Reconnecting");
    await expect(pill).toHaveAttribute("data-mt-state", "connected", { timeout: 15_000 });
    await expect(pill).toHaveText("Connected");
  });
});
