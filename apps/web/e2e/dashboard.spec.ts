// Dashboard acceptance (Phase D7.3), against serve.ts on the `dashboard` scenario
// (DASHBOARD_PORT) and on the generated 300-node `large` scenario (LARGE_PORT).
import { expect, test, type Page, type Response } from "@playwright/test";
import { controlClient } from "./control.js";
import { DASHBOARD_CONTROL_PORT, DASHBOARD_PORT, LARGE_PORT } from "./ports.js";

const BASE = `http://127.0.0.1:${DASHBOARD_PORT}`;
const LARGE = `http://127.0.0.1:${LARGE_PORT}`;
const node = controlClient(DASHBOARD_CONTROL_PORT);
const KAYAK = 860116326;

const shortNames = (page: Page, section: string) =>
  page
    .locator(`[data-mt=card-section][data-mt-variant=${section}] [data-mt=node-short-name]`)
    .allTextContents();

async function open(page: Page, url = `${BASE}/`): Promise<void> {
  await page.goto(url);
  await expect(page.locator("[data-mt=node-card]").first()).toBeVisible();
}

test("is the landing page: my node first, favorites pinned", async ({ page }) => {
  await open(page);
  await expect(page).toHaveURL(`${BASE}/dashboard`);
  await expect(page.locator("[data-mt=node-card]").first()).toHaveAttribute(
    "data-mt-variant",
    /(^| )self( |$)/,
  );
  expect(await shortNames(page, "self")).toEqual(["MTB"]);
  expect(await shortNames(page, "favorites")).toEqual(["RDG", "HIL"]);
  expect(await page.locator("[data-mt=node-card]").count()).toBe(7);
  // Every card has a map or the placeholder, and the powered node says so.
  await expect(page.locator("[data-mt=mini-map]")).toHaveCount(7);
  await expect(page.locator("[data-mt=mini-map][data-mt-state=empty]")).toHaveCount(2);
  await expect(
    page.locator("[data-node-num='195939070'] [data-mt=metric-row][data-mt-variant=power]"),
  ).toContainText("Powered");
});

test("filter and sort survive a reload", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Has position" }).click();
  await page.getByRole("combobox").selectOption("name");
  expect(await shortNames(page, "all")).toEqual(["GAR", "TRL"]);
  await page.reload();
  await expect(page.locator("[data-mt=node-card]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Has position" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("combobox")).toHaveValue("name");
  expect(await shortNames(page, "all")).toEqual(["GAR", "TRL"]);
});

test("injected telemetry updates a card live, with the update flash and no refetch", async ({
  page,
}) => {
  const dashboardCalls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/dashboard") && req.url().includes("/api/")) {
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
  await open(page);
  await subscribed;
  const card = page.locator(`[data-mt=node-card][data-node-num='${KAYAK}']`);
  const level = 30 + Math.floor(Math.random() * 60);
  await node.injectTelemetry(KAYAK, { device: { batteryLevel: level, voltage: 3.8 } });
  await expect(card).toHaveAttribute("data-mt-state", "updated");
  await expect(card.locator("[data-mt=metric-row][data-mt-variant=power]")).toContainText(
    `${level}% · 3.80 V`,
  );
  await expect(card).not.toHaveAttribute("data-mt-state", "updated", { timeout: 3_000 });
  expect(dashboardCalls).toHaveLength(1);
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
  const response = await page.goto(`${BASE}/dashboard`);
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
  await second.goto(`${BASE}/dashboard`);
  await expect(second.locator("[data-mt=mini-map-tiles] img").first()).toBeVisible();
  await expect.poll(() => again.length).toBeGreaterThan(0);
  const firstUrls = new Set(first.map((r) => r.url()));
  const repeated = again.filter((r) => firstUrls.has(r.url()));
  expect(repeated.length).toBeGreaterThan(0);
  for (const r of repeated) expect(r.headers()["x-tile-cache"]).toBe("hit");
  await context.close();
});

test("has no horizontal page scroll", async ({ page }) => {
  await open(page);
  const overflow = await page.evaluate(() => {
    const main = document.querySelector("[data-mt=main]");
    return {
      page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      main: main ? main.scrollWidth > main.clientWidth : true,
    };
  });
  expect(overflow).toEqual({ page: false, main: false });
});

test("300 nodes: compact by default and virtualized", async ({ page }) => {
  await open(page, `${LARGE}/dashboard`);
  await expect(page.locator("[data-mt=dashboard]")).toHaveAttribute("data-mt-variant", "compact");
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
