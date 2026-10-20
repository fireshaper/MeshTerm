// Dashboard and Nodes page acceptance, against serve.ts on the `dashboard` scenario
// (DASHBOARD_PORT) and on the generated 300-node `large` scenario (LARGE_PORT).
import { expect, test, type Page, type Response } from "@playwright/test";
import { controlClient } from "./control.js";
import { DASHBOARD_CONTROL_PORT, DASHBOARD_PORT, LARGE_PORT } from "./ports.js";

const BASE = `http://127.0.0.1:${DASHBOARD_PORT}`;
const LARGE = `http://127.0.0.1:${LARGE_PORT}`;
const node = controlClient(DASHBOARD_CONTROL_PORT);
const GARAGE = 1584361601;

const previewNames = (page: Page, panel: string) =>
  page
    .locator(
      `[data-mt=panel][data-mt-variant=${panel}] [data-mt=node-preview] [data-mt=node-short-name]`,
    )
    .allTextContents();
const sectionNames = (page: Page, section: string) =>
  page
    .locator(`[data-mt=card-section][data-mt-variant=${section}] [data-mt=node-short-name]`)
    .allTextContents();

async function openDashboard(page: Page, url = `${BASE}/`): Promise<void> {
  await page.goto(url);
  await expect(page.locator("[data-mt=node-preview]").first()).toBeVisible();
}

async function openNodes(page: Page, url = `${BASE}/nodes`): Promise<void> {
  await page.goto(url);
  await expect(page.locator("[data-mt=node-card]").first()).toBeVisible();
}

test("is the landing page: KPIs, my node first, favorites pinned, recent nodes", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(page).toHaveURL(`${BASE}/dashboard`);
  await expect(page.locator("[data-mt=metric-card]")).toHaveCount(6);
  await expect(
    page.locator(
      "[data-mt=metric-card][data-mt-variant=network-nodes] [data-mt=metric-card-value]",
    ),
  ).toHaveText(/^\d+ \/ 7$/);
  expect(await previewNames(page, "pinned")).toEqual(["MTB", "RDG", "HIL"]);
  expect(await previewNames(page, "recent")).toContain("GAR");
  await expect(page.locator("[data-mt=attention-item]").first()).toContainText("Hilltop Solar");
  await page.getByRole("link", { name: /View all 7 nodes/ }).click();
  await expect(page).toHaveURL(`${BASE}/nodes`);
});

test("injected telemetry updates a card live, with the update flash and no refetch", async ({
  page,
}) => {
  const dashboardCalls: string[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/dashboard") && req.url().includes("/api/")) {
      dashboardCalls.push(req.url());
    }
  });
  // Inject only once the socket is subscribed (its snapshot has arrived).
  const subscribed = new Promise<void>((resolve) => {
    page.on("websocket", (ws) => {
      ws.on("framereceived", ({ payload }) => {
        if (String(payload).includes('"type":"snapshot"')) resolve();
      });
    });
  });
  await openDashboard(page);
  await subscribed;
  const card = page.locator(`[data-mt=node-preview][data-node-num='${GARAGE}']`);
  const level = 30 + Math.floor(Math.random() * 60);
  await node.injectTelemetry(GARAGE, { device: { batteryLevel: level, voltage: 3.8 } });
  await expect(card).toHaveAttribute("data-mt-state", "updated");
  await expect(card.locator("[data-mt=preview-stat][data-mt-variant=power]")).toContainText(
    `${level}%`,
  );
  await expect(card).not.toHaveAttribute("data-mt-state", "updated", { timeout: 3_000 });
  expect(dashboardCalls).toHaveLength(1);
});

test("Nodes page: filter, sort and view survive a reload", async ({ page }) => {
  await openNodes(page);
  await page.getByRole("button", { name: "Has position" }).click();
  await page.getByRole("combobox", { name: "Sort" }).selectOption("name");
  expect(await sectionNames(page, "all")).toEqual(["GAR", "TRL"]);
  await page.reload();
  await expect(page.locator("[data-mt=node-card]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Has position" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("name");
  expect(await sectionNames(page, "all")).toEqual(["GAR", "TRL"]);

  await page.getByRole("button", { name: "Table" }).click();
  await page.reload();
  await expect(page.locator("[data-mt=node-row]").first()).toBeVisible();
  expect(await page.locator("[data-mt=node-row]").count()).toBe(5); // those with a position
});

test("mini maps load through the tile proxy and come from its cache the second time", async ({
  page,
  browser,
}) => {
  const tileResponses = (p: Page) => {
    const list: Response[] = [];
    p.on("response", (r) => {
      if (r.url().includes("/api/tiles/")) list.push(r);
    });
    return list;
  };
  const first = tileResponses(page);
  const response = await page.goto(`${BASE}/nodes`);
  expect(response?.headers()["content-security-policy"]).toContain("img-src 'self' data:");
  const tiles = page.locator("[data-mt=mini-map-tiles] img").first();
  await expect(tiles).toBeVisible();
  await expect.poll(() => first.length).toBeGreaterThan(0);
  await expect
    .poll(() => tiles.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(256);
  for (const r of first) {
    expect(r.status()).toBe(200);
    expect(new URL(r.url()).origin).toBe(BASE);
  }

  // A fresh browser context (empty HTTP cache): the server answers from its tile cache.
  const context = await browser.newContext();
  const second = await context.newPage();
  const again = tileResponses(second);
  await second.goto(`${BASE}/nodes`);
  await expect(second.locator("[data-mt=mini-map-tiles] img").first()).toBeVisible();
  await expect.poll(() => again.length).toBeGreaterThan(0);
  const firstUrls = new Set(first.map((r) => r.url()));
  const repeated = again.filter((r) => firstUrls.has(r.url()));
  expect(repeated.length).toBeGreaterThan(0);
  for (const r of repeated) expect(r.headers()["x-tile-cache"]).toBe("hit");
  await context.close();
});

test("no horizontal page scroll at phone, tablet, laptop and wide desktop widths", async ({
  page,
}) => {
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/dashboard", "/nodes"]) {
      await page.goto(`${BASE}${path}`);
      await expect(page.locator("[data-mt=page-title]")).toBeVisible();
      await expect(
        page.locator("[data-mt=dashboard-waiting], [data-mt=node-list-waiting]"),
      ).toHaveCount(0);
      const overflow = await page.evaluate(() => {
        const main = document.querySelector("[data-mt=main]");
        return {
          page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          main: main ? main.scrollWidth > main.clientWidth : true,
        };
      });
      expect(overflow, `${path} at ${width} px`).toEqual({ page: false, main: false });
    }
  }
});

test("300 nodes: the Nodes page is compact by default and virtualized", async ({ page }) => {
  await openNodes(page, `${LARGE}/nodes`);
  await expect(page.locator("[data-mt=node-cards]")).toHaveAttribute("data-mt-variant", "compact");
  await expect(page.locator("[data-mt=mini-map]")).toHaveCount(0);
  const initial = await page.locator("[data-mt=node-card]").count();
  expect(initial).toBeGreaterThan(0);
  expect(initial).toBeLessThan(100);
  const firstNums = await page
    .locator("[data-mt=node-card]")
    .evaluateAll((cards) => cards.map((c) => c.getAttribute("data-node-num")));

  await page.locator("[data-mt=main]").evaluate((main) => {
    main.scrollTop = main.scrollHeight;
  });
  await expect
    .poll(async () => {
      const nums = await page
        .locator("[data-mt=node-card]")
        .evaluateAll((cards) => cards.map((c) => c.getAttribute("data-node-num")));
      return nums.some((n) => !firstNums.includes(n));
    })
    .toBe(true);
  expect(await page.locator("[data-mt=node-card]").count()).toBeLessThan(100);
});

test("300 nodes: the dashboard previews a few and links to the rest", async ({ page }) => {
  await openDashboard(page, `${LARGE}/dashboard`);
  expect(await page.locator("[data-mt=node-preview]").count()).toBeLessThan(60);
  await expect(page.getByRole("link", { name: /View all 300 nodes/ })).toBeVisible();
});

test("the activity feed shows a received message live", async ({ page }, info) => {
  const subscribed = new Promise<void>((resolve) => {
    page.on("websocket", (ws) => {
      ws.on("framereceived", ({ payload }) => {
        if (String(payload).includes('"type":"snapshot"')) resolve();
      });
    });
  });
  await openDashboard(page);
  await subscribed;
  const text = `feed check ${info.project.name} ${Date.now()}`;
  await node.injectText(GARAGE, { channel: 0 }, text);
  const item = page.locator("[data-mt=activity-item]").first();
  await expect(item).toContainText(text);
  await expect(item).toContainText("Garage Station");
});

test("node details open from a preview and close with Escape", async ({ page }) => {
  await openDashboard(page);
  await page
    .locator(`[data-mt=node-preview][data-node-num='${GARAGE}']`)
    .getByRole("button", { name: "Details" })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Garage Station" })).toBeVisible();
  await expect(drawer.locator("[data-mt=detail-section][data-mt-variant=history]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("Reconnect redoes the handshake and transmits nothing on the mesh", async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute("data-mt-state", "connected");
  await node.clearInbound();
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByText("Reconnecting to your node…")).toBeVisible();
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute(
    "data-mt-state",
    "connected",
    {
      timeout: 10_000,
    },
  );
  await expect.poll(async () => (await node.inbound()).counts.handshake).toBeGreaterThanOrEqual(1);
  const audit = await node.inbound();
  expect(audit.counts.transmit).toBe(0);
  await expect(
    page.locator("[data-mt=activity-item][data-mt-variant='connection.restored']").first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("the traffic chart switches windows", async ({ page }) => {
  await openDashboard(page);
  const traffic = page.locator("[data-mt=panel][data-mt-variant=traffic]");
  await expect(traffic.locator("[data-mt=chart]")).toBeVisible();
  const request = page.waitForRequest((r) => r.url().endsWith("/traffic?window=1h"));
  await traffic.getByRole("button", { name: "1 h" }).click();
  await request;
  await expect(traffic.getByRole("button", { name: "1 h" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the network overview draws reported links and packets show up by type", async ({ page }) => {
  const RIDGE = 195939070;
  const TRAIL = 439041101;
  await node.injectNeighbors(RIDGE, [{ nodeId: TRAIL, snr: -2.25 }]);
  await openDashboard(page);
  const map = page.locator("[data-mt=network-map]");
  await expect(map.locator("[data-mt=network-link][data-mt-variant=reported]")).not.toHaveCount(0);
  // Every link is either a direct observation or a reported one.
  const kinds = await map
    .locator("[data-mt=network-link]")
    .evaluateAll((links) => links.map((l) => l.getAttribute("data-mt-variant")));
  expect(kinds.every((k) => k === "direct" || k === "reported")).toBe(true);
  await map.getByRole("button", { name: /^Trail Walker/ }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Trail Walker" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const traffic = page.locator("[data-mt=panel][data-mt-variant=traffic]");
  await traffic.getByRole("button", { name: "Packets" }).click();
  await expect(traffic.getByRole("img", { name: /Neighbor info/ })).toBeVisible();
  await expect(traffic.locator("[data-mt=busiest-node]").first()).toBeVisible();
});
