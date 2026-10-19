import { expect, test } from "@playwright/test";
import { fakeNode, RIDGE } from "./control.js";

test.describe("channel conversation", () => {
  test.beforeEach(async ({ page }) => {
    await fakeNode.setAckMode("ack");
    await page.goto("/channels/0");
    await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute(
      "data-mt-state",
      "connected",
    );
  });

  test("shows tabs for the scenario's two channels", async ({ page }) => {
    const tabs = page.locator("[data-mt=channel-tab]");
    await expect(tabs).toHaveText(["Primary", "Friends"]);
    await tabs.nth(1).click();
    await expect(page).toHaveURL(/\/channels\/1$/);
    await expect(tabs.nth(1)).toHaveAttribute("data-mt-state", "active");
  });

  test("a message from the mesh appears live", async ({ page }, info) => {
    const text = `from ridge ${info.project.name} ${Date.now()}`;
    await fakeNode.injectText(RIDGE, { channel: 0 }, text);
    const message = page.locator("[data-mt=message][data-mt-variant=in]", { hasText: text });
    await expect(message).toBeVisible();
    await expect(message.locator("[data-mt=message-sender]")).toHaveText("RDG");
  });

  test("sending hello: it appears, reaches acked, and the node gets one text transmit", async ({
    page,
  }, info) => {
    await fakeNode.clearInbound();
    const text = `hello ${info.project.name} ${Date.now()}`;
    const input = page.getByRole("textbox", { name: "Message" });
    await input.fill(text);
    await input.press("Enter");
    await expect(input).toHaveValue("");

    const message = page.locator("[data-mt=message][data-mt-variant=out]", { hasText: text });
    await expect(message).toBeVisible();
    await expect(message).toHaveAttribute("data-mt-state", "acked");
    await expect(message.locator("[data-mt=message-status]")).toHaveText("Acknowledged");

    const inbound = await fakeNode.inbound();
    expect(inbound.counts.transmit).toBe(1);
    expect(inbound.transmits[0]).toMatchObject({ to: 0xffff_ffff, channel: 0, text });
  });
});
