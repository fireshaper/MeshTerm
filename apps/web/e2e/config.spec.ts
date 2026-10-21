// Device settings (CR-002 Phase D2) against FakeNode's admin module, on the `config`
// instance (its own FakeNode, since applies change the node). Serial: they share it.
import { expect, test, type Page } from "@playwright/test";
import { controlClient } from "./control.js";
import { CONFIG_CONTROL_PORT, CONFIG_PORT } from "./ports.js";

const BASE = `http://127.0.0.1:${CONFIG_PORT}`;
const node = controlClient(CONFIG_CONTROL_PORT);

test.describe.configure({ mode: "serial" });

test.afterEach(async () => {
  await node.adminOptions({ clampTxPowerTo: null });
});

async function open(page: Page, section: string) {
  await page.goto(`${BASE}/settings/device?section=${section}`);
  await expect(page.locator("[data-mt=config-connection]")).toContainText("connected");
  await expect(page.locator("[data-mt=config-view]")).toHaveAttribute("data-mt-state", "editable");
}

const nav = (page: Page, title: string) =>
  page.locator("[data-mt=config-nav-item]").filter({ hasText: title });

/** A value different from the current one, so runs (desktop, then mobile) each change something. */
async function next(page: Page, label: string, a: string, b: string) {
  const input = page.getByLabel(label, { exact: true });
  const value = (await input.inputValue()) === a ? b : a;
  await input.fill(value);
  return value;
}

test("edit LoRa, Device and Display, review, apply: the node reboots and verifies", async ({
  page,
}) => {
  await node.clearInbound();
  const before = (await node.adminLog()).log.length;
  await open(page, "lora");
  const hops = await next(page, "Hop limit", "4", "5");
  await expect(
    page.locator("[data-mt=config-field][data-path='config.lora.hopLimit']"),
  ).toHaveAttribute("data-mt-state", "changed");
  await expect(page.locator("[data-mt=field-was]")).toContainText("was:");

  await nav(page, "Device").click();
  const nodeInfo = await next(page, "Node info broadcast (s)", "7200", "14400");
  await nav(page, "Display").click();
  const screen = await next(page, "Screen timeout (s)", "120", "300");

  const tray = page.getByRole("region", { name: "Pending changes" });
  await expect(tray).toContainText("3 pending changes in 3 sections · node will reboot");
  await expect(nav(page, "LoRa").locator("[data-mt=config-nav-badge]")).toHaveText("•1");

  // Nothing is sent before the apply.
  expect((await node.adminLog()).log.slice(before).filter((c) => c.startsWith("set"))).toEqual([]);

  await tray.getByRole("button", { name: "Review & apply" }).click();
  const dialog = page.getByRole("dialog", { name: "Review changes" });
  await expect(dialog.locator("[data-mt=diff-row]")).toHaveCount(3);
  await expect(dialog.getByRole("row", { name: /Hop limit/ })).toContainText(hops);
  await expect(dialog).toContainText("More than 3 hops costs everyone airtime.");
  await dialog.getByRole("button", { name: "Apply 3 changes" }).click();

  const progress = page.locator("[data-mt=apply-progress]");
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("data-mt-state", "verified", { timeout: 30_000 });
  await expect(progress).toContainText("Applied and verified");
  await expect(tray).toBeHidden();

  // The node has the new values, after a reload too.
  await page.reload();
  await open(page, "display");
  await expect(page.getByLabel("Screen timeout (s)", { exact: true })).toHaveValue(screen);
  await nav(page, "Device").click();
  await expect(page.getByLabel("Node info broadcast (s)", { exact: true })).toHaveValue(nodeInfo);

  const log = (await node.adminLog()).log;
  const sets = log.slice(log.lastIndexOf("beginEditSettings"));
  expect(sets).toEqual([
    "beginEditSettings",
    "setConfig",
    "setConfig",
    "setConfig",
    "commitEditSettings",
  ]);
  // Admin messages to our own node never reach the mesh.
  expect((await node.inbound()).counts.transmit).toBe(0);
});

test("a value the firmware clamps shows as a difference", async ({ page }) => {
  await node.adminOptions({ clampTxPowerTo: 20 });
  await open(page, "lora");
  await next(page, "TX power (dBm)", "27", "26");
  await page.getByRole("button", { name: "Review & apply" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apply 1 change" }).click();
  const progress = page.locator("[data-mt=apply-progress]");
  await expect(progress).toHaveAttribute("data-mt-state", "mismatched", { timeout: 30_000 });
  await expect(progress.getByRole("row", { name: /TX power/ })).toContainText("20 dBm");
  await expect(page.getByLabel("TX power (dBm)", { exact: true })).toHaveValue("20");
});

test("a lockout-class change needs the node's short name typed", async ({ page }) => {
  await open(page, "device");
  await page.getByLabel("Managed mode", { exact: true }).check();
  await expect(page.getByText(/MeshTerm won't be able to edit it any more/)).toBeVisible();
  await page.getByRole("button", { name: "Review & apply" }).click();
  const dialog = page.getByRole("dialog");
  const apply = dialog.getByRole("button", { name: "Apply 1 change" });
  await expect(apply).toBeDisabled();
  await dialog.locator("[data-mt=typed-confirm-input]").fill("MTB");
  await expect(apply).toBeEnabled();
  // Not applied: MeshTerm would lose access on a real node.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard all" }).click();
  await expect(page.getByLabel("Managed mode", { exact: true })).not.toBeChecked();
});

test("another browser's apply locks the editor and marks conflicting edits", async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await open(a, "lora");
  await open(b, "lora");
  await next(a, "Hop limit", "6", "7");
  const theirs = await next(b, "Hop limit", "2", "1");
  await b.getByRole("button", { name: "Review & apply" }).click();
  await b.getByRole("dialog").getByRole("button", { name: "Apply 1 change" }).click();

  await expect(a.locator("[data-mt=config-lock]")).toContainText("Apply in progress");
  await expect(a.getByLabel("Hop limit", { exact: true })).toBeDisabled();
  await expect(b.locator("[data-mt=apply-progress]")).toHaveAttribute("data-mt-state", "verified", {
    timeout: 30_000,
  });

  const field = a.locator("[data-mt=config-field][data-path='config.lora.hopLimit']");
  await expect(field).toHaveAttribute("data-mt-state", "changed conflict");
  await expect(field).toContainText(`Changed on device: now ${theirs}.`);
  await field.getByRole("button", { name: "Use node's value" }).click();
  await expect(a.getByLabel("Hop limit", { exact: true })).toHaveValue(theirs);
  await expect(a.getByRole("region", { name: "Pending changes" })).toBeHidden();
  await a.context().close();
  await b.context().close();
});
