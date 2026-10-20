// Map page (map-view-spec Phase A), against serve.ts on the `dashboard` scenario: five
// nodes with positions (Trail with reduced precision), Kayak and Bike without.
import { expect, test, type Page } from "@playwright/test";
import { controlClient } from "./control.js";
import { DASHBOARD_CONTROL_PORT, DASHBOARD_PORT } from "./ports.js";

const BASE = `http://127.0.0.1:${DASHBOARD_PORT}`;
const node = controlClient(DASHBOARD_CONTROL_PORT);
const RIDGE = 195939070;
const TRAIL = 439041101;

async function openMap(page: Page, path = "/map"): Promise<void> {
  await page.goto(`${BASE}${path}`);
  await expect(page.locator("[data-mt=map-view]")).toHaveAttribute("data-mt-state", "ready", {
    timeout: 15_000,
  });
}

/** Rendered points: single nodes plus the nodes inside clusters. */
const renderedNodeCount = (page: Page) =>
  page.evaluate(`(() => {
    const map = window.__meshtermMap;
    const f = map.queryRenderedFeatures({ layers: ["mt-nodes", "mt-clusters"] });
    const seen = new Set();
    let n = 0;
    for (const x of f) {
      const key = x.properties.cluster ? "c" + x.properties.cluster_id : "n" + x.properties.num;
      if (seen.has(key)) continue;
      seen.add(key);
      n += x.properties.cluster ? x.properties.point_count : 1;
    }
    return n;
  })()`);

/** Clicks the node's dot on the canvas. */
async function clickNode(page: Page, num: number): Promise<void> {
  const point = await page.evaluate<{ x: number; y: number }>(`(async () => {
    const map = window.__meshtermMap;
    const data = await map.getSource("mt-nodes").getData();
    const f = data.features.find((x) => x.properties.num === ${num});
    map.jumpTo({ center: f.geometry.coordinates, zoom: 15 });
    await new Promise((r) => map.once("idle", r));
    const p = map.project(f.geometry.coordinates);
    const box = map.getCanvas().getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y };
  })()`);
  await page.mouse.click(point.x, point.y);
}

test("opens from the navigation and shows every node with a position", async ({ page }) => {
  await page.goto(`${BASE}/dashboard`);
  const narrow = (page.viewportSize()?.width ?? 0) < 768;
  if (narrow) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Map" }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.locator("[data-mt=map-view]")).toHaveAttribute("data-mt-state", "ready", {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Fit all nodes" }).click();
  await expect.poll(() => renderedNodeCount(page), { timeout: 10_000 }).toBe(5);
  // Tiles come through the proxy; the OSM credit is shown.
  await expect(page.locator("[data-mt=map-attribution]")).toContainText("OpenStreetMap");
});

test("clicking a marker shows its info; Details opens the node drawer", async ({ page }) => {
  await openMap(page);
  await clickNode(page, RIDGE);
  // The popover is a zero-size anchor at the node; its card is what shows.
  const popover = page.locator("[data-mt=map-popover] [data-mt=map-popover-card]");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Ridge Repeater");
  await expect(popover).toContainText("!0badcafe");
  await expect(popover).toContainText("External power");
  await expect(popover).toContainText("Heard directly");
  await popover.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog", { name: "Ridge Repeater" }).first()).toBeVisible();
});

test("lists nodes that aren't on the map", async ({ page }) => {
  await openMap(page);
  const toggle = page.getByRole("button", { name: "Not on map (2)" });
  await toggle.click();
  const list = page.getByRole("list", { name: "Nodes without a position" });
  await expect(list).toContainText("Kayak");
  await expect(list).toContainText("Bike");
});

test("deep link ?focus= centers on the node and opens its popup", async ({ page }) => {
  await openMap(page, "/map?focus=!1a2b3c4d");
  const popover = page.locator(
    `[data-mt=map-popover][data-node-num='${TRAIL}'] [data-mt=map-popover-card]`,
  );
  await expect(popover).toBeVisible();
  // (Its precision may have changed: the live-move test sends an exact position.)
  await expect(popover).toContainText("Trail Walker");
});

test("old links' decimal ?node= still focus the node (and don't open the drawer)", async ({
  page,
}) => {
  await openMap(page, `/map?node=${TRAIL}`);
  await expect(
    page.locator(`[data-mt=map-popover][data-node-num='${TRAIL}'] [data-mt=map-popover-card]`),
  ).toBeVisible();
  await expect(page.locator("[data-mt=node-drawer]")).toHaveCount(0);
});

test("a new position moves the marker live", async ({ page }) => {
  await openMap(page);
  const subscribed = page.waitForEvent("websocket");
  await page.reload();
  await (
    await subscribed
  ).waitForEvent("framereceived", (f) => String(f.payload).includes('"type":"snapshot"'));
  await expect(page.locator("[data-mt=map-view]")).toHaveAttribute("data-mt-state", "ready");
  const lat = 47.5 + Math.random() / 10;
  await node.injectPosition(TRAIL, lat, -122.05);
  await expect
    .poll(
      () =>
        page.evaluate(`(async () => {
          const data = await window.__meshtermMap.getSource("mt-nodes").getData();
          return data.features.find((x) => x.properties.num === ${TRAIL}).geometry.coordinates[1];
        })()`),
      { timeout: 10_000 },
    )
    .toBeCloseTo(lat, 4);
});

test("remembers the viewport", async ({ page }) => {
  await openMap(page);
  await page.evaluate(`(async () => {
    const map = window.__meshtermMap;
    map.jumpTo({ center: [-121.5, 46.5], zoom: 9 });
    await new Promise((r) => setTimeout(r, 300));
  })()`);
  await page.reload();
  await expect(page.locator("[data-mt=map-view]")).toHaveAttribute("data-mt-state", "ready");
  const view = await page.evaluate<[number, number, number]>(
    `(() => { const m = window.__meshtermMap; const c = m.getCenter(); return [c.lng, c.lat, m.getZoom()]; })()`,
  );
  expect(view[0]).toBeCloseTo(-121.5, 1);
  expect(view[1]).toBeCloseTo(46.5, 1);
  expect(view[2]).toBeCloseTo(9, 1);
});

test("dashboard mini maps link here", async ({ page }) => {
  await page.goto(`${BASE}/nodes`);
  await page
    .locator(`[data-mt=node-card][data-node-num='${RIDGE}'] [data-mt=mini-map-link]`)
    .click();
  await expect(page).toHaveURL(/\/map\?focus=(%21|!)0badcafe$/);
  await expect(
    page.locator(`[data-mt=map-popover][data-node-num='${RIDGE}'] [data-mt=map-popover-card]`),
  ).toBeVisible({
    timeout: 15_000,
  });
});

test("fills the screen without horizontal scroll", async ({ page }) => {
  await openMap(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  const box = await page.locator("[data-mt=map-view]").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(300);
});
