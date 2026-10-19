// Visual baselines (Step 11.2, D7.3): channel view, node list, DM view and dashboard in
// the Default theme, at 1280 px (visual-desktop) and 390 px (visual-mobile).
//
// Runs against its own server instance (VISUAL_PORT) seeded once with fixed content,
// so other specs can't change what is drawn. Relative times are masked.
// Baselines are per platform; the Linux ones are made in the Playwright Docker image,
// which CI also runs in. Update them with `pnpm test:visual:update` (see CLAUDE.md).
import { expect, test, type Page } from "@playwright/test";
import { controlClient, ME, RIDGE, TRAIL } from "./control.js";
import { VISUAL_CONTROL_PORT, VISUAL_DASHBOARD_PORT, VISUAL_PORT } from "./ports.js";

const BASE = `http://127.0.0.1:${VISUAL_PORT}`;
const node = controlClient(VISUAL_CONTROL_PORT);

const CHANNEL = [
  { from: RIDGE, text: "Morning! Anyone heading up the ridge trail today?" },
  { from: TRAIL, text: "On my way now, should be at the saddle in about 30 minutes." },
];
const DM_IN = "Can you relay a message to base camp for me?";
const DM_OUT = "Sure, sending it on now.";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seeds the visual server once (both viewports share it). Firmware times are whole
 * seconds, so messages are a second apart to keep their order deterministic. */
async function seed(): Promise<void> {
  const res = await fetch(`${BASE}/api/connections/1/messages?channel=0`);
  const { messages } = (await res.json()) as { messages: unknown[] };
  if (messages.length > 0) return;

  await node.setAckMode("ack");
  for (const { from, text } of CHANNEL) {
    await node.injectText(from, { channel: 0 }, text);
    await pause(1_100);
  }
  await node.injectText(RIDGE, { to: ME }, DM_IN);
  await pause(1_100);
  const sent = await fetch(`${BASE}/api/connections/1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: DM_OUT, to: RIDGE }),
  });
  expect(sent.status).toBe(201);
  await expect
    .poll(async () => {
      const dm = await fetch(`${BASE}/api/connections/1/messages?peer=${RIDGE}`);
      const body = (await dm.json()) as { messages: { text: string; status: string | null }[] };
      return body.messages.find((m) => m.text === DM_OUT)?.status;
    })
    .toBe("acked");
}

test.beforeAll(async () => {
  await seed();
});

const MASKS = (page: Page) => [
  page.locator("[data-mt=message-time]"),
  page.locator("[data-mt=node-last-heard]"),
];

async function ready(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute("data-mt-state", "connected");
}

test("channel view", async ({ page }) => {
  await ready(page, "/channels/0");
  await expect(page.locator("[data-mt=message]")).toHaveCount(2);
  await expect(page).toHaveScreenshot("channel-view.png", { mask: MASKS(page) });
});

test("node list", async ({ page }) => {
  await ready(page, "/nodes");
  await expect(page.locator("[data-mt=node-row]")).toHaveCount(4);
  await expect(page).toHaveScreenshot("node-list.png", { mask: MASKS(page) });
});

test("DM view", async ({ page }) => {
  await ready(page, `/dm/${RIDGE}`);
  await expect(page.locator("[data-mt=message]")).toHaveCount(2);
  await expect(page.locator("[data-mt=message][data-mt-variant=out]")).toHaveAttribute(
    "data-mt-state",
    "acked",
  );
  await expect(page).toHaveScreenshot("dm-view.png", { mask: MASKS(page) });
});

test("dashboard", async ({ page }) => {
  // Its own instance on the `dashboard` scenario; map tiles come from the fake tile server.
  await page.goto(`http://127.0.0.1:${VISUAL_DASHBOARD_PORT}/dashboard`);
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute("data-mt-state", "connected");
  await expect(page.locator("[data-mt=node-card]")).toHaveCount(7);
  // Every tile in view has loaded (lazy ones below the fold don't matter).
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>("[data-mt=mini-map-tiles] img")]
          .filter((img) => img.getBoundingClientRect().top < window.innerHeight)
          .every((img) => img.complete && img.naturalWidth > 0),
      ),
    )
    .toBe(true);
  await expect(page).toHaveScreenshot("dashboard.png", {
    mask: [
      page.locator("[data-mt=node-card] time"),
      page.locator("[data-mt=status-tile][data-mt-variant=connection] [data-mt=status-tile-value]"),
      page.locator(
        "[data-mt=status-tile][data-mt-variant=last-packet] [data-mt=status-tile-value]",
      ),
    ],
  });
});
