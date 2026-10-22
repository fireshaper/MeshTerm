// CR-003 notifications end to end, against serve.ts on the default scenario: mention
// keywords, Do Not Disturb, per-conversation levels and the reconnect summary.
// Settings are per user (everyone is user 0 here), so each test puts them back.
import { expect, test, type Page } from "@playwright/test";
import { fakeNode, ME, RIDGE, socketSubscribed } from "./control.js";

const GARDEN = 0x5e6f7081;

async function resetPrefs(page: Page): Promise<void> {
  await page.request.patch("/api/me/notification-prefs", {
    data: { dndUntil: null, quietHours: null, mentionKeywords: [], matchShortName: true },
  });
  await page.request.patch("/api/connections/1/conversations/channel/1", {
    data: { notifyLevel: "mentions" },
  });
}

test.beforeEach(async ({ page }) => {
  await resetPrefs(page);
});
test.afterEach(async ({ page }) => {
  await resetPrefs(page);
});

const toastWith = (page: Page, text: string) =>
  page.locator("[data-mt=toast-region] [data-mt=toast]", { hasText: text });

test("a keyword from Settings makes a channel message a mention", async ({ page }, info) => {
  await page.goto("/settings/notifications");
  await page.getByLabel("Mention keywords").fill("pancakes");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("[data-mt=toaster]")).toContainText("Mention keywords saved.");

  const subscribed = socketSubscribed(page);
  await page.goto("/nodes");
  await subscribed;
  const text = `pancakes at 8? ${info.project.name} ${Date.now()}`;
  await fakeNode.injectText(RIDGE, { channel: 1 }, text);
  await expect(toastWith(page, text)).toHaveAttribute("data-mt-variant", "mention");

  // A plain message on the same channel (level: mentions) only counts.
  const plain = `plain ${info.project.name} ${Date.now()}`;
  await fakeNode.injectText(RIDGE, { channel: 1 }, plain);
  await page.waitForTimeout(1_000);
  await expect(toastWith(page, plain)).toHaveCount(0);
});

test("Do Not Disturb from the bell: no pop-up, but the bell counts it", async ({ page }, info) => {
  const subscribed = socketSubscribed(page);
  await page.goto("/nodes");
  await subscribed;
  await page.locator("[data-mt=notification-bell]").click();
  await page.getByRole("menuitem", { name: "For 1 hour" }).click();
  await expect(page.locator("[data-mt=notification-bell]")).toHaveAttribute("data-mt-state", "dnd");
  const text = `quiet please ${info.project.name} ${Date.now()}`;
  await fakeNode.injectText(GARDEN, { to: ME }, text);
  await expect(page.locator("[data-mt=notification-bell]")).toHaveAttribute("aria-label", /unread/);
  await expect(toastWith(page, text)).toHaveCount(0);
});

test("a channel set to All messages pops up for every message", async ({ page }, info) => {
  await page.goto("/messages/channel/1");
  await page.getByRole("button", { name: /^Notifications: Mentions only/ }).click();
  await page.getByRole("menuitemradio", { name: "All messages" }).click();
  await expect(page.getByRole("button", { name: "Notifications: All messages" })).toBeVisible();

  const subscribed = socketSubscribed(page);
  await page.goto("/nodes");
  await subscribed;
  const text = `chatter ${info.project.name} ${Date.now()}`;
  await fakeNode.injectText(RIDGE, { channel: 1 }, text);
  await expect(toastWith(page, text)).toHaveAttribute("data-mt-variant", "channel");
});

test("messages that waited for MeshTerm during a reconnect: one summary", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: it waits for the 30 s window");
  test.setTimeout(90_000);
  const subscribed = socketSubscribed(page);
  await page.goto("/nodes");
  await subscribed;
  await fakeNode.reboot(1_000);
  await expect(page.locator("[data-mt=status-pill]")).not.toHaveAttribute(
    "data-mt-state",
    "connected",
    { timeout: 10_000 },
  );
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute(
    "data-mt-state",
    "connected",
    { timeout: 20_000 },
  );
  // Heard five minutes ago, delivered now: the burst after a reconnect.
  const old = Date.now() - 5 * 60_000;
  for (let i = 0; i < 3; i++) {
    await fakeNode.injectText(GARDEN, { to: ME }, `while away ${i} ${Date.now()}`, {
      rxTimeMs: old + i * 1_000,
    });
  }
  const summary = page.locator("[data-mt=toast-region] [data-mt=toast][data-mt-variant=backlog]");
  await expect(summary).toContainText("3 messages arrived while disconnected (3 DMs)", {
    timeout: 45_000,
  });
  // None of them popped up on its own.
  await expect(
    page.locator("[data-mt=toast-region] [data-mt=toast][data-mt-variant=dm]"),
  ).toHaveCount(0);
});
