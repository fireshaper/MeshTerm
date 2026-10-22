// Node detail drawer (CR-001 Phase C2): URL-driven, over any view.
import { expect, test, type Page } from "@playwright/test";
import { fakeNode, socketSubscribed } from "./control.js";
import { DASHBOARD_PORT } from "./ports.js";

const DASH = `http://127.0.0.1:${DASHBOARD_PORT}`;
const narrow = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;
const drawer = (page: Page) => page.locator("[data-mt=node-drawer]");

test("opens from a dashboard card, puts ?node= in the URL; Back closes it in place", async ({
  page,
}) => {
  await page.goto(`${DASH}/nodes`);
  const card = page.locator("[data-mt=node-card][data-node-num='195939070']");
  await card.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(
    () => document.querySelector("[data-mt=main]")?.scrollTop ?? 0,
  );
  await card.getByRole("button", { name: "Details" }).click();
  await expect(page).toHaveURL(/\/nodes\?node=(%21|!)0badcafe$/);
  const dialog = page.getByRole("dialog", { name: "Ridge Repeater" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-mt=detail-field][data-mt-variant=id]")).toContainText(
    "!0badcafe",
  );
  await page.goBack();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/nodes$/);
  expect(await page.evaluate(() => document.querySelector("[data-mt=main]")?.scrollTop ?? 0)).toBe(
    scrolled,
  );
});

test("a ?node= deep link opens it over another view; Escape closes and stays there", async ({
  page,
}) => {
  await page.goto(`${DASH}/messages/channel/0?node=!1a2b3c4d`);
  const dialog = page.getByRole("dialog", { name: "Trail Walker" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/messages\/channel\/0$/);
});

test("tabs: Telemetry draws a chart, Raw shows JSON", async ({ page }) => {
  await page.goto(`${DASH}/dashboard?node=!0badcafe`);
  const dialog = page.getByRole("dialog", { name: "Ridge Repeater" });
  await dialog.getByRole("tab", { name: "Telemetry" }).click();
  await expect(dialog.locator("[data-mt=chart-group]").first()).toBeVisible();
  await dialog.getByRole("tab", { name: "Raw" }).click();
  await dialog.locator("[data-mt=raw-json][data-mt-variant=node] summary").click();
  await expect(dialog.locator("[data-mt=raw-json-body]").first()).toContainText('"num": 195939070');
});

test("a channel message's sender opens the drawer", async ({ page }) => {
  await page.goto(`${DASH}/messages/channel/0`);
  // The dashboard scenario has no stored messages: the activity spec may have added one.
  const sender = page.locator("[data-mt=message-sender]").first();
  test.skip((await sender.count()) === 0, "no channel messages on this instance yet");
  await sender.click();
  await expect(drawer(page)).toBeVisible();
});

test("phone: full screen; desktop: resizable and remembered", async ({ page }) => {
  await page.goto(`${DASH}/nodes?node=!0badcafe`);
  await expect(drawer(page)).toBeVisible();
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const box = await drawer(page).boundingBox();
  if (narrow(page)) {
    expect(Math.round(box?.width ?? 0)).toBe(viewport.width);
    return;
  }
  expect(Math.round(box?.width ?? 0)).toBe(480);
  const handle = page.getByRole("separator", { name: "Resize details" });
  const h = await handle.boundingBox();
  if (!h) throw new Error("no handle");
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 120, h.y + h.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await drawer(page).boundingBox())?.width ?? 0))
    .toBe(600);
  await page.reload();
  await expect
    .poll(async () => Math.round((await drawer(page).boundingBox())?.width ?? 0))
    .toBe(600);
});

// ------------------------------------------------ Request telemetry (CR-001 C4)

test("Request telemetry: confirm, one request over the mesh, and the answer arrives", async ({
  page,
}, info) => {
  // One node per project: a node can be asked once every 5 minutes.
  const [num, id, name] =
    info.project.name === "desktop"
      ? [0x0badcafe, "!0badcafe", "Ridge Repeater"]
      : [0x1a2b3c4d, "!1a2b3c4d", "Trail Walker"];
  await fakeNode.clearInbound();
  const subscribed = socketSubscribed(page);
  await page.goto(`/nodes?node=${id}`);
  await subscribed;
  const dialog = page.getByRole("dialog", { name });
  await dialog.getByRole("button", { name: "Request telemetry" }).click();
  const confirm = page.getByRole("dialog", { name: /^Request telemetry from/ });
  await expect(confirm).toContainText("use airtime");
  await confirm.getByLabel("What to ask for").selectOption("environment");
  await confirm.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator("[data-mt=toaster]")).toContainText("environment telemetry.", {
    timeout: 10_000,
  });
  await expect(page.locator("[data-mt=toaster]")).toContainText("sent its environment telemetry");
  const audit = await fakeNode.inbound();
  expect(audit.transmits.filter((t) => t.to === num && t.portnum === 67)).toHaveLength(1);

  // Again right away: refused.
  await dialog.getByRole("button", { name: "Request telemetry" }).click();
  await page
    .getByRole("dialog", { name: /^Request telemetry from/ })
    .getByRole("button", { name: "Send request" })
    .click();
  await expect(page.locator("[data-mt=toaster]")).toContainText("try again in");
});
