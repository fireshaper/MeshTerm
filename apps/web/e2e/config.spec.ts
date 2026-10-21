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

// ------------------------------------------------------------------ Phase D3

const ADD_LINK = "https://meshtastic.org/e/?add=true#ChcSEAECAwQFBgcICQoLDA0ODxAaA09wcw";
const REPLACE_LINK = "https://meshtastic.org/e/#CgMSAQEKFxIQAQIDBAUGBwgJCgsMDQ4PEBoDT3Bz";

test("rename a channel and make a new key: setChannel, verified", async ({ page }) => {
  const before = (await node.adminLog()).log.length;
  await open(page, "channels");
  await page.locator("[data-mt=channel-slot]").nth(1).click();
  const name = await next(page, "Name", "Hikers", "Friends");
  await page.getByLabel("Key type").selectOption("random256");
  await expect(page.getByLabel("Key type")).toHaveValue("custom");
  await page.getByRole("button", { name: "Review & apply" }).click();
  const dialog = page.getByRole("dialog", { name: "Review changes" });
  await expect(dialog.getByRole("row", { name: /Key/ })).toContainText("(changed)");
  await dialog.getByRole("button", { name: "Apply 2 changes" }).click();
  await expect(page.locator("[data-mt=apply-progress]")).toHaveAttribute(
    "data-mt-state",
    "verified",
    {
      timeout: 30_000,
    },
  );
  await expect(page.locator("[data-mt=channel-slot]").nth(1)).toContainText(name);
  expect((await node.adminLog()).log.slice(before)).toContain("setChannel");
  expect((await node.inbound()).counts.transmit).toBe(0);
});

test("share link: the QR code and a link that reads back", async ({ page }) => {
  await open(page, "channels");
  await page.getByRole("button", { name: "Share link / QR…" }).click();
  const dialog = page.getByRole("dialog", { name: "Share channels" });
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.locator("[data-mt=qr-code] path")).toHaveAttribute("d", /^M/);
  await expect(dialog.getByRole("textbox", { name: "Channel link" })).toHaveValue(
    /^https:\/\/meshtastic\.org\/e\/#/,
  );
});

test("import a link: Add stages a new slot, Replace the whole set; nothing is sent", async ({
  page,
}) => {
  const before = (await node.adminLog()).log.length;
  await open(page, "channels");
  await page.getByRole("button", { name: "Import link…" }).click();
  let dialog = page.getByRole("dialog", { name: "Import a channel link" });
  await dialog.getByLabel("Channel link").fill(ADD_LINK);
  await dialog.getByRole("button", { name: "Read link" }).click();
  await expect(dialog.getByLabel(/^Add:/)).toBeChecked();
  await expect(dialog.getByRole("row", { name: /#2 · Name/ })).toContainText("Ops");
  await dialog.getByRole("button", { name: /^Stage \d+ changes$/ }).click();
  await expect(page.locator("[data-mt=channel-slot]").nth(2)).toContainText("Ops");
  await page.getByRole("button", { name: "Discard all" }).click();

  await page.getByRole("button", { name: "Import link…" }).click();
  dialog = page.getByRole("dialog", { name: "Import a channel link" });
  await dialog.getByLabel("Channel link").fill(REPLACE_LINK);
  await dialog.getByRole("button", { name: "Read link" }).click();
  await expect(dialog.getByLabel(/^Replace:/)).toBeChecked();
  await dialog.getByRole("button", { name: /^Stage \d+ changes$/ }).click();
  await expect(page.locator("[data-mt=channel-slot]").nth(1)).toContainText("Ops");
  await page.getByRole("button", { name: "Review & apply" }).click();
  await expect(page.getByRole("dialog", { name: "Review changes" })).toContainText("#1 Ops · Name");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard all" }).click();
  expect((await node.adminLog()).log.slice(before).filter((c) => c.startsWith("set"))).toEqual([]);
});

test("fixed position picked on the map: setFixedPosition, then removed again", async ({ page }) => {
  const before = (await node.adminLog()).log.length;
  await open(page, "position");
  const fixed = page.getByLabel("Fixed position", { exact: true });
  await fixed.check();
  await page.getByRole("button", { name: "Pick on map…" }).click();
  const picker = page.getByRole("dialog", { name: "Pick the fixed position" });
  await expect.poll(() => page.evaluate(() => "__meshtermPickerMap" in window)).toBe(true);
  await picker.locator("[data-mt=map-picker] canvas").click();
  await expect(picker.locator("[data-mt=map-picker-point]")).toHaveText(
    /^-?\d+\.\d{6}, -?\d+\.\d{6}$/,
  );
  await picker.getByRole("button", { name: "Use this point" }).click();
  await expect(page.getByLabel("Latitude", { exact: true })).not.toHaveValue("");

  const applyAll = async () => {
    await page.getByRole("button", { name: "Review & apply" }).click();
    await page
      .getByRole("dialog", { name: "Review changes" })
      .getByRole("button", { name: /^Apply \d+ changes?$/ })
      .click();
    await expect(page.locator("[data-mt=apply-progress]")).toHaveAttribute(
      "data-mt-state",
      "verified",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "Dismiss" }).click();
  };
  await applyAll();
  expect((await node.adminLog()).log.slice(before)).toContain("setFixedPosition");

  await fixed.uncheck();
  await applyAll();
  expect((await node.adminLog()).log.slice(before)).toContain("removeFixedPosition");
  await expect(fixed).not.toBeChecked();
});

// ------------------------------------------------------------------ Phase D4

async function applyAll(page: Page, typed?: string) {
  await page.getByRole("button", { name: "Review & apply" }).click();
  const dialog = page.getByRole("dialog", { name: "Review changes" });
  if (typed) await dialog.locator("[data-mt=typed-confirm-input]").fill(typed);
  await dialog.getByRole("button", { name: /^Apply \d+ changes?$/ }).click();
  await expect(page.locator("[data-mt=apply-progress]")).toHaveAttribute(
    "data-mt-state",
    "verified",
    {
      timeout: 30_000,
    },
  );
  await page.getByRole("button", { name: "Dismiss" }).click();
}

test("a module section: telemetry interval, setModuleConfig, verified", async ({ page }) => {
  const before = (await node.adminLog()).log.length;
  await open(page, "module-telemetry");
  const value = await next(page, "Device metrics interval (s)", "3600", "2700");
  await applyAll(page);
  await expect(page.getByLabel("Device metrics interval (s)", { exact: true })).toHaveValue(value);
  expect((await node.adminLog()).log.slice(before)).toContain("setModuleConfig");
});

test("network: a static address needs the short name and shows where MeshTerm will look", async ({
  page,
}) => {
  await open(page, "network");
  await page.getByLabel("Address", { exact: true }).selectOption("STATIC");
  await page.getByLabel("IP address", { exact: true }).fill("10.9.8.7");
  await page.getByRole("button", { name: "Review & apply" }).click();
  const dialog = page.getByRole("dialog", { name: "Review changes" });
  await expect(dialog.getByRole("note")).toContainText("10.9.8.7");
  await expect(dialog.getByRole("button", { name: /^Apply/ })).toBeDisabled();
  await dialog.locator("[data-mt=typed-confirm-input]").fill("MTB");
  await expect(dialog.getByRole("button", { name: /^Apply/ })).toBeEnabled();
  // Not applied: the FakeNode can't move to 10.9.8.7.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard all" }).click();
});

test("backup: download YAML, import it back, restore a snapshot; nothing is sent", async ({
  page,
}) => {
  const before = (await node.adminLog()).log.length;
  await open(page, "backup");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download backup" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^meshterm-MTB-\d{4}-\d{2}-\d{2}\.yaml$/);
  const path = await file.path();
  const { readFileSync } = await import("node:fs");
  const yaml = readFileSync(path, "utf8").replace(/owner: .*/, "owner: Restored Base");
  expect(yaml).not.toMatch(/^channel_url:/m);

  await page.getByLabel(/Choose a YAML file/).setInputFiles({
    name: "base.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(yaml),
  });
  let dialog = page.getByRole("dialog", { name: "Import base.yaml" });
  await expect(dialog.getByRole("row", { name: /Long name/ })).toContainText("Restored Base");
  await dialog.getByRole("button", { name: /^Stage \d+ changes?$/ }).click();
  await expect(page.getByRole("region", { name: "Pending changes" })).toBeVisible();
  await page.getByRole("button", { name: "Discard all" }).click();

  // Earlier tests applied changes, so there are snapshots.
  await page.getByRole("button", { name: "Restore…" }).first().click();
  dialog = page.getByRole("dialog", { name: /^Restore the snapshot of/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await node.adminLog()).log.slice(before).filter((c) => c.startsWith("set"))).toEqual([]);
});

test("maintenance: reboot reconnects; a device reset waits for the name and the countdown", async ({
  page,
}) => {
  const before = (await node.adminLog()).log.length;
  await open(page, "maintenance");
  await page.getByRole("button", { name: "Reboot…" }).click();
  await page
    .getByRole("dialog", { name: "Reboot" })
    .getByRole("button", { name: "Reboot" })
    .click();
  await expect(page.locator("[data-mt=config-connection]")).not.toContainText("connected", {
    timeout: 10_000,
  });
  await expect(page.locator("[data-mt=config-connection]")).toContainText("connected", {
    timeout: 30_000,
  });
  expect((await node.adminLog()).log.slice(before)).toContain("rebootSeconds");

  await page.getByRole("button", { name: "Factory reset (device)…" }).click();
  const dialog = page.getByRole("dialog", { name: "Factory reset (device)" });
  await dialog.locator("[data-mt=typed-confirm-input]").fill("MTB");
  await expect(
    dialog.getByRole("button", { name: /^Factory reset \(device\) \(\d\)$/ }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Factory reset (device)", exact: true }),
  ).toBeEnabled({
    timeout: 8_000,
  });
  // Not sent: the shared FakeNode keeps its settings.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await node.adminLog()).log.slice(before)).not.toContain("factoryResetDevice");
});
