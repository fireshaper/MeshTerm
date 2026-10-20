// Messages view (messages-spec Phase 2): one list of channels and DMs, two panes from
// 768 px, list → thread below. Against serve.ts on the default scenario.
import { expect, test, type Page } from "@playwright/test";
import { fakeNode, ME, socketSubscribed } from "./control.js";

const GARDEN = 0x5e6f7081;
const narrow = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

test("a DM from a node you've never messaged appears under Direct messages, live", async ({
  page,
}, info) => {
  const subscribed = socketSubscribed(page);
  await page.goto("/messages");
  await subscribed;
  if (!narrow(page)) await expect(page).toHaveURL(/\/messages\/(channel|dm)\//);
  const text = `pki hello ${info.project.name} ${Date.now()}`;
  await fakeNode.injectText(GARDEN, { to: ME }, text, { pkiEncrypted: true });

  const row = page.locator(`[data-mt=conversation-row][data-node-num="${GARDEN}"]`);
  await expect(row).toContainText(text);
  await expect(row).toContainText("GAR");
  await expect(row.getByLabel("End-to-end encrypted")).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/messages\/dm\/!5e6f7081$/);
  await expect(
    page.locator("[data-mt=message][data-mt-variant=in]", { hasText: text }),
  ).toBeVisible();
});

test("New opens the node picker; picking a node opens its thread", async ({ page }) => {
  await page.goto("/messages");
  await page.getByRole("button", { name: "New" }).click();
  const picker = page.getByRole("dialog", { name: "New direct message" });
  await picker.getByRole("searchbox", { name: "Search nodes" }).fill("trl");
  await picker.locator("[data-mt=node-picker-item]").first().click();
  await expect(page).toHaveURL(/\/messages\/dm\/!1a2b3c4d$/);
  await expect(page.locator("[data-mt=thread-header][data-mt-variant=dm]")).toContainText(
    "!1a2b3c4d",
  );
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
});

test("old /dm and /channels links redirect to the Messages view", async ({ page }) => {
  await page.goto("/dm/195939070");
  await expect(page).toHaveURL(/\/messages\/dm\/!0badcafe$/);
  await page.goto("/channels/1");
  await expect(page).toHaveURL(/\/messages\/channel\/1$/);
  await expect(page.getByRole("heading", { level: 2, name: "#Friends" })).toBeVisible();
});

test("phone: the thread replaces the list, and Back returns to it", async ({ page }) => {
  test.skip(!narrow(page), "phones only");
  await page.goto("/messages");
  const list = page.locator("[data-mt=conversation-list]");
  await expect(list).toBeVisible();
  await expect(page.locator("[data-mt=thread-pane]")).toBeHidden();
  await list.locator("[data-mt=conversation-row]", { hasText: "#LongFast" }).click();
  await expect(page).toHaveURL(/\/messages\/channel\/0$/);
  await expect(list).toBeHidden();
  await expect(page.locator("[data-mt=thread]")).toBeVisible();
  await page.getByRole("link", { name: "Back to conversations" }).click();
  await expect(list).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("desktop: both panes show, and /messages reopens the last conversation", async ({ page }) => {
  test.skip(narrow(page), "two panes from 768 px");
  await page.goto("/messages/channel/1");
  await expect(page.locator("[data-mt=conversation-list]")).toBeVisible();
  await expect(page.locator("[data-mt=thread]")).toBeVisible();
  await page.goto("/messages");
  await expect(page).toHaveURL(/\/messages\/channel\/1$/);
});
