// Node drawer charts (CR-001 Phase C3), against the `history` instance: the dashboard
// scenario with 30 days of backdated telemetry (FakeNode historyPackets). Read-only.
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { controlClient } from "./control.js";
import { DASHBOARD_CONTROL_PORT, DASHBOARD_PORT, HISTORY_PORT } from "./ports.js";

const HISTORY = `http://127.0.0.1:${HISTORY_PORT}`;
const GARDEN = 0x5e6f7081;

async function telemetryTab(page: Page, base: string, id: string, name: string): Promise<Locator> {
  await page.goto(`${base}/nodes?node=${id}`);
  const dialog = page.getByRole("dialog", { name });
  await dialog.getByRole("tab", { name: "Telemetry" }).click();
  return dialog;
}

const group = (dialog: Locator, variant: string) =>
  dialog.locator(`[data-mt=chart-group][data-mt-variant="${variant}"]`);

test("a battery node: battery, voltage, radio load and uptime charts with summaries", async ({
  page,
}) => {
  const dialog = await telemetryTab(page, HISTORY, "!5e6f7081", "Garage Station");
  for (const g of ["battery", "voltage", "radio", "uptime"]) {
    await expect(group(dialog, g)).toHaveAttribute("data-mt-state", "ready");
  }
  await expect(group(dialog, "battery").getByRole("img")).toHaveAccessibleName(
    /^Battery, 24 h: Battery min \d+% max \d+% latest \d+%$/,
  );
  await expect(group(dialog, "battery").locator("canvas").first()).toBeVisible();
});

test("crosshair is synced across charts; drag zooms all, double-click resets", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, "pointer interactions on desktop");
  const dialog = await telemetryTab(page, HISTORY, "!5e6f7081", "Garage Station");
  const battery = group(dialog, "battery").locator(".u-over");
  await expect(battery).toBeVisible();
  const box = await battery.boundingBox();
  if (!box) throw new Error("no plot");
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  // Every chart's tooltip follows the one cursor.
  await expect
    .poll(() => dialog.locator("[data-mt=chart-tooltip]:visible").count())
    .toBeGreaterThan(2);

  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const canvases = dialog.locator("[data-mt=chart-canvas]");
  await expect(canvases.first()).toHaveAttribute("data-mt-state", "zoomed");
  await expect(canvases.nth(2)).toHaveAttribute("data-mt-state", "zoomed");
  await battery.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(canvases.nth(2)).toHaveAttribute("data-mt-state", "range");
});

test("30 d: a reboot on the uptime chart; ranges are shared with Signal and remembered", async ({
  page,
}) => {
  const dialog = await telemetryTab(page, HISTORY, "!5e6f7081", "Garage Station");
  await dialog.getByRole("button", { name: "30 d" }).click();
  await expect(group(dialog, "uptime")).toHaveAttribute("data-mt-state", "ready");
  await group(dialog, "uptime").getByRole("button", { name: "View as table" }).click();
  // The reboot 5 days ago: uptime drops back to minutes.
  await expect(group(dialog, "uptime").getByRole("table")).toContainText(/\d+(m|h)\b/);
  await dialog.getByRole("tab", { name: "Signal" }).click();
  await expect(dialog.getByRole("button", { name: "30 d" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByText("Signal history is kept for 7 days.")).toBeVisible();
  await page.reload();
  await page.getByRole("dialog").getByRole("tab", { name: "Telemetry" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "30 d" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("external power is a Powered band; sensors and power monitors get their own charts", async ({
  page,
}) => {
  let dialog = await telemetryTab(page, HISTORY, "!0badcafe", "Ridge Repeater");
  await expect(group(dialog, "battery")).toHaveAttribute("data-mt-state", "ready");
  await expect(group(dialog, "battery").getByRole("img")).toHaveAccessibleName(
    /Battery, 24 h: Battery: no data/,
  );
  dialog = await telemetryTab(page, HISTORY, "!1a2b3c4d", "Trail Walker");
  for (const g of ["env-temperature", "env-relative_humidity", "env-gas_resistance", "env-lux"]) {
    await expect(group(dialog, g)).toHaveAttribute("data-mt-state", "ready");
  }
  dialog = await telemetryTab(page, HISTORY, "!22334455", "Hilltop Solar");
  await expect(group(dialog, "power-ch1")).toHaveAttribute("data-mt-state", "ready");
  await expect(group(dialog, "power-ch2")).toHaveAttribute("data-mt-state", "ready");
  dialog = await telemetryTab(page, HISTORY, "!55667788", "Bike");
  await expect(dialog.getByText(/has never sent telemetry/)).toBeVisible();
});

test("Signal: SNR and RSSI of a node heard directly, hops and packet rate", async ({ page }) => {
  await page.goto(`${HISTORY}/nodes?node=!0badcafe`);
  const dialog = page.getByRole("dialog", { name: "Ridge Repeater" });
  await dialog.getByRole("tab", { name: "Signal" }).click();
  await dialog.getByRole("button", { name: "24 h" }).click();
  await expect(group(dialog, "snr").getByRole("img")).toHaveAccessibleName(/SNR min/);
  await expect(group(dialog, "rssi").getByRole("img")).toHaveAccessibleName(/RSSI min -\d+ dBm/);
  await expect(group(dialog, "packets")).toHaveAttribute("data-mt-state", "ready");
});

test("Export CSV downloads the raw samples of the range", async ({ page }) => {
  const dialog = await telemetryTab(page, HISTORY, "!1a2b3c4d", "Trail Walker");
  await dialog.getByRole("button", { name: "24 h" }).click();
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("node-1a2b3c4d-telemetry.csv");
  const csv = readFileSync(await file.path(), "utf8").split("\n");
  expect(csv[0]).toMatch(/^time,kind,.*temperature/);
  expect(csv.length).toBeGreaterThan(40);
});

test("a live report shows up without refetching the series", async ({ page }) => {
  // The dashboard instance (mutable): Garage reports device telemetry live.
  const dialog = await telemetryTab(
    page,
    `http://127.0.0.1:${DASHBOARD_PORT}`,
    "!5e6f7081",
    "Garage Station",
  );
  await dialog.getByRole("button", { name: "1 h" }).click();
  let fetches = 0;
  page.on("request", (r) => {
    if (r.url().includes(`/nodes/${GARDEN}/telemetry`)) fetches++;
  });
  await expect(
    dialog.locator("[data-mt=chart-group], [data-mt=chart-empty]").first(),
  ).toBeVisible();
  const voltage = 3.5 + Math.round(Math.random() * 40) / 100;
  await controlClient(DASHBOARD_CONTROL_PORT).injectTelemetry(GARDEN, {
    device: { batteryLevel: 44, voltage },
  });
  const g = group(dialog, "voltage");
  await expect(g).toHaveAttribute("data-mt-state", "ready");
  await g.getByRole("button", { name: "View as table" }).click();
  await expect(g.getByRole("table")).toContainText(`${voltage.toFixed(2)} V`);
  expect(fetches).toBe(0);
});
