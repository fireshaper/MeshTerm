// Visual baselines (Step 11.2, D7.3): channel view, node list, DM view, dashboard and device settings in
// the Default theme, at 1280 px (visual-desktop) and 390 px (visual-mobile).
//
// Runs against its own server instance (VISUAL_PORT) seeded once with fixed content,
// so other specs can't change what is drawn. Relative times are masked.
// Baselines are per platform; the Linux ones are made in the Playwright Docker image,
// which CI also runs in. Update them with `pnpm test:visual:update` (see CLAUDE.md).
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { controlClient, ME, RIDGE, TRAIL } from "./control.js";
import {
  VISUAL_CONTROL_PORT,
  VISUAL_DASHBOARD_CONTROL_PORT,
  HISTORY_PORT,
  VISUAL_DASHBOARD_PORT,
  VISUAL_PORT,
} from "./ports.js";

const BASE = `http://127.0.0.1:${VISUAL_PORT}`;
/** A second visual instance on the `dashboard` scenario. */
const DASH = `http://127.0.0.1:${VISUAL_DASHBOARD_PORT}`;
/** The read-only instance with 30 days of telemetry history. */
const HISTORY = `http://127.0.0.1:${HISTORY_PORT}`;
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

/** Everything read, so no unread badge depends on which screen opened a thread first. */
async function readAll(): Promise<void> {
  for (const path of ["channel/0", "channel/1", `dm/${RIDGE}`]) {
    const res = await fetch(`${BASE}/api/connections/1/conversations/${path}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  }
}

test.beforeAll(async () => {
  await seed();
  await readAll();
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
  "[data-mt=thread-details]",
  // Node drawer (outside [data-mt=main]: it's a portal).
  "[data-mt=node-drawer-seen]",
  // Notifications (CR-003).
  "[data-mt=toast-time]",
  "[data-mt=notification-time]",
  "[data-mt=node-drawer] [data-mt=detail-age]",
  "[data-mt=node-drawer] time",
  "[data-mt=detail-field][data-mt-variant=last-heard] dd",
  "[data-mt=detail-field][data-mt-variant=first-seen] dd",
  "[data-mt=detail-field][data-mt-variant=packets] dd",
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
  await ready(page, "/messages/channel/0");
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
  await ready(page, "/messages/dm/!0badcafe");
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

test("node drawer", async ({ page }) => {
  await ready(page, `${DASH}/nodes?node=!0badcafe`);
  const drawer = page.getByRole("dialog", { name: "Ridge Repeater" });
  await expect(drawer).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLImageElement>(
            "[data-mt=node-drawer] [data-mt=mini-map-tiles] img",
          ),
        ].every((img) => img.complete && img.naturalWidth > 0),
      ),
    )
    .toBe(true);
  await freeze(page);
  await expect(page).toHaveScreenshot("node-drawer.png", { mask: MASKS(page) });
});

test("node drawer telemetry charts", async ({ page }) => {
  await ready(page, `${HISTORY}/nodes?node=!5e6f7081`);
  const drawer = page.getByRole("dialog", { name: "Garage Station" });
  await drawer.getByRole("tab", { name: "Telemetry" }).click();
  for (const g of ["battery", "voltage", "radio", "uptime"]) {
    await expect(
      drawer.locator(`[data-mt=chart-group][data-mt-variant=${g}] canvas`).first(),
    ).toBeVisible();
  }
  await page.mouse.move(0, 0);
  await freeze(page);
  // The time axis is drawn on the canvas (its labels follow the clock) and buckets
  // align to wall-clock time: a little more room than the DOM screens get.
  await expect(drawer).toHaveScreenshot("node-drawer-telemetry.png", {
    mask: MASKS(page),
    maxDiffPixelRatio: 0.04,
    threshold: 0.3,
  });
});

test("map", async ({ page }) => {
  await seedDashboard();
  // A fresh visit: no remembered viewport, so the map fits all nodes.
  await ready(page, `${DASH}/map`);
  await expect(page.locator("[data-mt=map-view]")).toHaveAttribute("data-mt-state", "ready");
  await page.evaluate(
    `new Promise((resolve) => {
      const map = window.__meshtermMap;
      if (map.loaded() && map.areTilesLoaded()) resolve();
      else map.once("idle", () => resolve());
    })`,
  );
  await freeze(page);
  // WebGL renders in software (SwiftShader) here, and its anti-aliasing differs a little
  // between CPUs, so the map gets more room than the DOM screens. A missing marker,
  // wrong colors or a layout change still exceed it.
  await expect(page).toHaveScreenshot("map.png", {
    mask: MASKS(page),
    maxDiffPixelRatio: 0.03,
    threshold: 0.3,
  });
});

test("device settings", async ({ page }) => {
  await ready(page, "/settings/device?section=lora");
  // A staged edit (never applied): the changed field, "was:", the nav badge and the tray.
  const hops = page.getByLabel("Hop limit", { exact: true });
  await expect(hops).toBeEditable();
  await hops.fill("4");
  await expect(page.getByRole("region", { name: "Pending changes" })).toBeVisible();
  await page.locator("[data-mt=config-field][data-path='config.lora.hopLimit']").evaluate((el) => {
    el.scrollIntoView({ block: "center" });
  });
  await freeze(page);
  await expect(page).toHaveScreenshot("device-settings.png", { mask: MASKS(page) });
});

test("device channels", async ({ page }) => {
  await ready(page, "/settings/device?section=channels");
  await page.locator("[data-mt=channel-slot]").nth(1).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeEditable();
  await freeze(page);
  await expect(page).toHaveScreenshot("device-channels.png", { mask: MASKS(page) });
});

test("device network", async ({ page }) => {
  await ready(page, "/settings/device?section=network");
  // A staged static address: the IP fields and a lockout-class warning.
  await page.getByLabel("Address", { exact: true }).selectOption("STATIC");
  await page.getByLabel("IP address", { exact: true }).fill("192.168.1.20");
  await page
    .locator("[data-mt=config-field][data-path='config.network.addressMode']")
    .evaluate((el) => {
      el.scrollIntoView({ block: "start" });
    });
  await freeze(page);
  await expect(page).toHaveScreenshot("device-network.png", { mask: MASKS(page) });
});

test("device maintenance", async ({ page }) => {
  await ready(page, "/settings/device?section=maintenance");
  await expect(page.getByRole("button", { name: "Reboot…" })).toBeEnabled();
  await freeze(page);
  await expect(page).toHaveScreenshot("device-maintenance.png", { mask: MASKS(page) });
});

/** A DM from Garage Station, fed straight into the page (nothing is stored on the server). */
const FAKE_DM = {
  type: "message.new",
  message: {
    id: "00000000-0000-4000-8000-00000000c0de",
    connectionId: 1,
    packetId: 424242,
    fromNum: 0x5e6f7081,
    toNum: ME,
    peer: 0x5e6f7081,
    channelIndex: 0,
    text: "Gate code changed to 4417, see you at the shop",
    rxTime: 1_800_000_000_000,
    direction: "in",
    status: null,
    rxSnr: null,
    rxRssi: null,
    pkiEncrypted: true,
    viaMqtt: false,
    replyId: null,
    emoji: false,
    hopStart: null,
    hopLimit: null,
    errorReason: null,
    relayed: false,
  },
  notify: { level: "notify", reason: "dm", backlog: false },
};

test("notifications: a toast, then the bell", async ({ page }) => {
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    socket = ws;
    ws.connectToServer();
  });
  await ready(page, "/nodes");
  await expect(page.locator("[data-mt=node-card]")).toHaveCount(4);
  await expect.poll(() => socket !== null).toBe(true);
  (socket as unknown as WebSocketRoute).send(JSON.stringify(FAKE_DM));
  await expect(page.locator("[data-mt=toast-region] [data-mt=toast]")).toBeVisible();
  await freeze(page);
  await expect(page).toHaveScreenshot("notification-toast.png", { mask: MASKS(page) });

  await page.locator("[data-mt=toast-region] [data-mt=icon-button]").click();
  await page.locator("[data-mt=notification-bell]").click();
  await expect(page.locator("[data-mt=notification-item]")).toHaveCount(1);
  await expect(page).toHaveScreenshot("notification-bell.png", { mask: MASKS(page) });
});

test("notification settings", async ({ page }) => {
  await ready(page, "/settings/notifications");
  await expect(page.getByLabel("Mention keywords")).toBeVisible();
  await freeze(page);
  await expect(page).toHaveScreenshot("notification-settings.png", { mask: MASKS(page) });
});
