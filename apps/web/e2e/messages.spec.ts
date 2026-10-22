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

// ------------------------------------------------------------- read state (CR-003 N0)

test("an unread DM badges its row, the nav and the title; reading it in another browser clears them", async ({
  page,
  browser,
}, info) => {
  const TRAIL = 0x1a2b3c4d;
  const subscribed = socketSubscribed(page);
  await page.goto("/dashboard");
  await subscribed;
  const text = `unread ${info.project.name} ${Date.now()}`;
  await fakeNode.injectText(TRAIL, { to: ME }, text);

  // The title counts it, whatever else is unread on the shared node.
  await expect(page).toHaveTitle(/^\(\d+\+?\) MeshTerm$/);
  if (narrow(page)) {
    await expect(page.locator("[data-mt=menu-button] [data-mt=nav-badge]")).toBeVisible();
  } else {
    await expect(
      page.locator("[data-mt=sidebar] [data-mt=nav-badge][data-mt-state=priority]"),
    ).toBeVisible();
  }

  // The row shows its own count without opening it.
  const other = await (await browser.newContext()).newPage();
  await other.goto("/messages");
  const row = other.locator(`[data-mt=conversation-row][data-node-num="${TRAIL}"]`);
  await expect(row.locator("[data-mt=unread-badge]")).toBeVisible();
  await expect(row).toHaveAttribute("data-mt-state", /\bunread\b/);

  // Reading it in the second browser clears the first one's row too.
  const firstRow = page.locator(`[data-mt=conversation-row][data-node-num="${TRAIL}"]`);
  await page.goto("/messages");
  await expect(firstRow.locator("[data-mt=unread-badge]")).toBeVisible();
  await row.click();
  await expect(other.locator("[data-mt=message]", { hasText: text })).toBeVisible();
  await expect(firstRow.locator("[data-mt=unread-badge]")).toHaveCount(0, { timeout: 10_000 });
  await other.context().close();
});

// ------------------------------------------------------------- the tab (CR-003 N2)

/** Pretends the tab went to the background (headless pages are always "visible"). */
async function hideTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("a DM while the tab is hidden: the title flashes and the favicon gets a badge", async ({
  page,
}, info) => {
  const TRAIL = 0x1a2b3c4d;
  const subscribed = socketSubscribed(page);
  await page.goto("/nodes");
  await subscribed;
  await hideTab(page);
  const text = `flash ${info.project.name} ${Date.now()}`;
  await fakeNode.injectText(TRAIL, { to: ME }, text);
  await expect(page).toHaveTitle(/^💬 TRL: flash/, { timeout: 5_000 });
  await expect(page).toHaveTitle(/^\(\d+\+?\) MeshTerm$/, { timeout: 5_000 });
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /^data:image\/png/);
});

test("the title warns while the node is disconnected", async ({ page }) => {
  await page.goto("/nodes");
  await expect(page).toHaveTitle(/^(\(\d+\+?\) )?MeshTerm$/);
  await fakeNode.reboot(3_000);
  await expect(page).toHaveTitle(/^⚠ /, { timeout: 10_000 });
  await expect(page).toHaveTitle(/^(\(\d+\+?\) )?MeshTerm$/, { timeout: 20_000 });
});

// ------------------------------------------------- toasts and the bell (CR-003 N3)

test("a DM on another page: a toast you can reply from, and an entry in the bell", async ({
  page,
}, info) => {
  const subscribed = socketSubscribed(page);
  await page.goto("/nodes");
  await subscribed;
  const text = `toast ${info.project.name} ${Date.now()}`;
  await fakeNode.injectText(GARDEN, { to: ME }, text);

  // It arrived (the bell counts it) before checking that it popped up.
  await expect(page.locator("[data-mt=notification-bell]")).toHaveAttribute("aria-label", /unread/);
  const toast = page.locator("[data-mt=toast-region] [data-mt=toast]", { hasText: text });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-mt-variant", "dm");
  await toast.getByRole("button", { name: "Reply" }).click();
  const reply = `reply ${info.project.name} ${Date.now()}`;
  await toast.getByRole("textbox", { name: "Reply" }).fill(reply);
  await toast.getByRole("textbox", { name: "Reply" }).press("Enter");
  await expect(toast).toContainText("Sent");
  await expect
    .poll(async () => (await fakeNode.inbound()).transmits.some((t) => t.text === reply))
    .toBe(true);

  await page.locator("[data-mt=notification-bell]").click();
  await expect(page.locator("[data-mt=notification-item]", { hasText: text })).toHaveAttribute(
    "data-mt-state",
    "unread",
  );
  await page.locator("[data-mt=notification-item]", { hasText: text }).click();
  await expect(page).toHaveURL(/\/messages\/dm\/!5e6f7081$/);
});
