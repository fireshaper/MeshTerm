// Visual baselines (Step 11.2, D7.3): channel view, node list, DM view and dashboard in
// the Default theme, at 1280 px (visual-desktop) and 390 px (visual-mobile).
//
// Runs against its own server instance (VISUAL_PORT) seeded once with fixed content,
// so other specs can't change what is drawn. Relative times are masked.
// Baselines are per platform; the Linux ones are made in the Playwright Docker image,
// which CI also runs in. Update them with `pnpm test:visual:update` (see CLAUDE.md).
import { expect, test, type Page } from "@playwright/test";
import { controlClient, ME, RIDGE, TRAIL } from "./control.js";
import {
  VISUAL_CONTROL_PORT,
  VISUAL_DASHBOARD_CONTROL_PORT,
  VISUAL_DASHBOARD_PORT,
  VISUAL_PORT,
} from "./ports.js";

const BASE = `http://127.0.0.1:${VISUAL_PORT}`;
/** A second visual instance on the `dashboard` scenario. */
const DASH = `http://127.0.0.1:${VISUAL_DASHBOARD_PORT}`;
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

/** Everything whose text depends on the time (or on FakeNode's random port). */
const VOLATILE = [
  "[data-mt=message-time]",
  "[data-mt=main] time",
  "[data-mt=stale-note]",
  "[data-mt=metric-card-secondary]",
  "[data-mt=attention-text]",
  "[data-mt=chart-times]",
  "[data-mt=connection-link]",
];

const MASKS = (page: Page) => VOLATILE.map((selector) => page.locator(selector));

async function ready(page: Page, path: string): Promise<void> {
  // A controllable clock, so relative times can be frozen before the screenshot.
  await page.clock.install();
  await page.goto(path);
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute("data-mt-state", "connected");
}

/**
 * Stops the page's timers and replaces time-dependent text with a fixed placeholder.
 * Masks hide the pixels, but a text that changes width ("45 s ago" → "2 min ago")
 * would still move the layout around it.
 */
async function freeze(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
  await page.evaluate((selectors) => {
    for (const el of document.querySelectorAll(selectors.join(","))) el.textContent = "········";
  }, VOLATILE);
}

test("channel view", async ({ page }) => {
  await ready(page, "/channels/0");
  await expect(page.locator("[data-mt=message]")).toHaveCount(2);
  await freeze(page);
  await expect(page).toHaveScreenshot("channel-view.png", { mask: MASKS(page) });
});

test("node list", async ({ page }) => {
  await ready(page, "/nodes");
  await expect(page.locator("[data-mt=node-card]")).toHaveCount(4);
  await freeze(page);
  await expect(page).toHaveScreenshot("node-list.png", { mask: MASKS(page) });
});

test("DM view", async ({ page }) => {
  await ready(page, `/dm/${RIDGE}`);
  await expect(page.locator("[data-mt=message]")).toHaveCount(2);
  await expect(page.locator("[data-mt=message][data-mt-variant=out]")).toHaveAttribute(
    "data-mt-state",
    "acked",
  );
  await freeze(page);
  await expect(page).toHaveScreenshot("dm-view.png", { mask: MASKS(page) });
});

/** The dashboard instance: one NeighborInfo report, so the network view has a reported link. */
async function seedDashboard(): Promise<void> {
  const res = await fetch(`${DASH}/api/connections/1/topology`);
  const topology = (await res.json()) as { links: { kind: string }[] };
  if (topology.links.some((l) => l.kind === "reported")) return;
  await controlClient(VISUAL_DASHBOARD_CONTROL_PORT).injectNeighbors(RIDGE, [
    { nodeId: 439041101, snr: -2.25 },
  ]);
  await expect
    .poll(async () => {
      const again = (await (await fetch(`${DASH}/api/connections/1/topology`)).json()) as {
        links: { kind: string }[];
      };
      return again.links.some((l) => l.kind === "reported");
    })
    .toBe(true);
}

test("dashboard", async ({ page }) => {
  await seedDashboard();
  await ready(page, `${DASH}/dashboard`);
  await expect(page.locator("[data-mt=node-preview]")).toHaveCount(5);
  // Panels with their own queries: wait until none shows a loading skeleton.
  await expect(page.locator("[data-mt=chart][data-mt-state=ready]")).toHaveCount(1);
  await expect(page.locator("[data-mt=network-link][data-mt-variant=reported]")).not.toHaveCount(0);
  await expect(page.locator("[data-mt=main] [data-mt=skeleton]")).toHaveCount(0);
  await freeze(page);
  await expect(page).toHaveScreenshot("dashboard.png", { mask: MASKS(page) });
});

test("nodes with mini maps", async ({ page }) => {
  // The dashboard scenario has positions; map tiles come from the fake tile server.
  await ready(page, `${DASH}/nodes`);
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
  await freeze(page);
  await expect(page).toHaveScreenshot("nodes-cards.png", { mask: MASKS(page) });
});

test("nodes table", async ({ page }) => {
  await ready(page, `${DASH}/nodes`);
  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.locator("[data-mt=node-row]")).toHaveCount(7);
  await freeze(page);
  await expect(page).toHaveScreenshot("nodes-table.png", { mask: MASKS(page) });
});
