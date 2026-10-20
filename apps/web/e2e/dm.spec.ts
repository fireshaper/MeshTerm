import { expect, test } from "@playwright/test";
import { fakeNode, ME, RIDGE } from "./control.js";

test.describe("nodes and direct messages", () => {
  test.beforeEach(async () => {
    await fakeNode.setAckMode("ack");
  });

  test("the node list shows the scenario's nodes with my node marked", async ({ page }) => {
    // Order depends on what earlier specs made the mesh hear (sorting is unit-tested).
    await page.goto("/nodes");
    const cards = page.locator("[data-mt=node-card]");
    await expect(cards).toHaveCount(4);
    const shortNames = await cards.locator("[data-mt=node-short-name]").allTextContents();
    expect(shortNames.sort()).toEqual(["GAR", "MTB", "RDG", "TRL"]);
    await expect(page.locator(`[data-mt=node-card][data-node-num="${ME}"]`)).toHaveAttribute(
      "data-mt-variant",
      /(^| )self( |$)/,
    );
    await expect(page.locator("[data-mt=node-card][data-mt-variant~=self]")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });

  test("open a DM from the node list, send to the peer, and receive their reply live", async ({
    page,
  }, info) => {
    await page.goto("/nodes");
    await page
      .locator(`[data-mt=node-card][data-node-num="${RIDGE}"]`)
      .getByRole("button", { name: "Message" })
      .click();
    await expect(page).toHaveURL(/\/messages\/dm\/!0badcafe$/);
    await expect(page.locator("[data-mt=thread-title]")).toHaveText("Ridge Repeater");

    await fakeNode.clearInbound();
    const outText = `dm to ridge ${info.project.name} ${Date.now()}`;
    const input = page.getByRole("textbox", { name: "Message" });
    await input.fill(outText);
    await input.press("Enter");
    const sent = page.locator("[data-mt=message][data-mt-variant=out]", { hasText: outText });
    await expect(sent).toHaveAttribute("data-mt-state", "acked");
    const inbound = await fakeNode.inbound();
    expect(inbound.counts.transmit).toBe(1);
    expect(inbound.transmits[0]).toMatchObject({ to: RIDGE, text: outText });

    const reply = `reply from ridge ${info.project.name} ${Date.now()}`;
    await fakeNode.injectText(RIDGE, { to: ME }, reply);
    await expect(
      page.locator("[data-mt=message][data-mt-variant=in]", { hasText: reply }),
    ).toBeVisible();

    await page.goto("/messages/channel/0");
    await expect(page.locator("[data-mt=message-list]")).toBeVisible();
    // (The conversation list may preview the DM; the channel thread must not show it.)
    const thread = page.locator("[data-mt=message-list]");
    await expect(thread.getByText(reply)).toHaveCount(0);
    await expect(thread.getByText(outText)).toHaveCount(0);
  });
});
