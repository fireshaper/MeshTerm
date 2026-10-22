// Hook audit (CR-004 §5.2): walks the main screens and fails when a meaningful element
// has no `data-mt` hook, or carries a hook, state or variant that isn't registered in
// packages/shared/src/theme-hooks.ts. Themes rely on these hooks, so gaps are bugs.
import { THEME_HOOKS } from "@meshterm/shared";
import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD_PORT, HISTORY_PORT } from "./ports.js";

interface Problem {
  screen: string;
  problem: string;
}

/** Interactive and structural elements a theme must be able to target. */
const MEANINGFUL = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "table",
  "tr",
  "dialog",
  "[role=dialog]",
  "[role=alertdialog]",
  "[role=tab]",
  "[role=tabpanel]",
  "[role=menu]",
  "[role=menuitem]",
  "[role=menuitemradio]",
  "[role=menuitemcheckbox]",
  "[role=radio]",
  "[role=status]",
  "[role=alert]",
].join(",");

async function audit(page: Page, screen: string): Promise<Problem[]> {
  const found = await page.evaluate((selector) => {
    const out: { kind: string; detail: string }[] = [];
    const describe = (el: Element) => {
      const text = el.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
      const label = el.getAttribute("aria-label") ?? "";
      return `<${el.tagName.toLowerCase()}${label ? ` aria-label="${label}"` : ""}> ${text}`;
    };
    // MapLibre draws its own controls; the map container itself is hooked.
    const foreign = (el: Element) => el.closest(".maplibregl-map") !== null;
    for (const el of document.querySelectorAll(selector)) {
      if (foreign(el) || el.closest("[aria-hidden=true]")) continue;
      const own = el.hasAttribute("data-mt");
      // A form control may take its hook from the label or field around it.
      const control = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
      const viaParent =
        control &&
        (el.parentElement?.hasAttribute("data-mt") === true ||
          el.closest("label")?.hasAttribute("data-mt") === true);
      if (!own && !viaParent) out.push({ kind: "missing", detail: describe(el) });
    }
    for (const el of document.querySelectorAll("[data-mt]")) {
      out.push({
        kind: "hook",
        detail: JSON.stringify([
          el.getAttribute("data-mt"),
          el.getAttribute("data-mt-state"),
          el.getAttribute("data-mt-variant"),
        ]),
      });
    }
    return out;
  }, MEANINGFUL);

  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    if (f.kind === "missing") {
      problems.push({ screen, problem: `no data-mt: ${f.detail}` });
      continue;
    }
    if (seen.has(f.detail)) continue;
    seen.add(f.detail);
    const [name, state, variant] = JSON.parse(f.detail) as [string, string | null, string | null];
    const hook = THEME_HOOKS[name];
    if (!hook) {
      problems.push({ screen, problem: `unregistered hook "${name}"` });
      continue;
    }
    if (state !== null && !hook.openStates && !(hook.states ?? []).includes(state)) {
      problems.push({ screen, problem: `unregistered state "${state}" on "${name}"` });
    }
    if (variant !== null && !hook.openVariants && !(hook.variants ?? []).includes(variant)) {
      problems.push({ screen, problem: `unregistered variant "${variant}" on "${name}"` });
    }
  }
  return problems;
}

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
};

test("every meaningful element on the main screens has a registered hook", async ({ page }) => {
  test.setTimeout(180_000);
  const problems: Problem[] = [];
  const visit = async (screen: string, url: string, then?: () => Promise<void>) => {
    await page.goto(url);
    await expect(
      page
        .locator(
          "[data-mt=page-title], [data-mt=thread-title], [data-mt=map-view][data-mt-state=ready], [role=dialog]",
        )
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await settle(page);
    if (then) {
      await then();
      await settle(page);
    }
    problems.push(...(await audit(page, screen)));
  };
  const H = `http://127.0.0.1:${HISTORY_PORT}`;
  const D = `http://127.0.0.1:${DASHBOARD_PORT}`;

  await visit("dashboard", `${H}/dashboard`);
  await visit("nodes (cards)", `${H}/nodes`);
  await visit("nodes (table)", `${H}/nodes`, async () => {
    await page.getByRole("button", { name: "Table" }).click();
  });
  for (const tab of ["Overview", "Telemetry", "Signal", "Raw"]) {
    await visit(`node drawer: ${tab}`, `${H}/nodes?node=!5e6f7081`, async () => {
      await page.getByRole("dialog").getByRole("tab", { name: tab }).click();
    });
  }
  await visit("map", `${D}/map`);
  await visit("messages: channel", "/messages/channel/0");
  await visit("messages: DM", "/messages/dm/!0badcafe");
  await visit("notification bell", "/dashboard", async () => {
    await page.locator("[data-mt=notification-bell]").click();
  });
  await visit("user menu", "/dashboard", async () => {
    await page.locator("[data-mt=user-menu]").click();
  });
  for (const section of [
    "user",
    "device",
    "lora",
    "channels",
    "position",
    "power",
    "network",
    "display",
    "bluetooth",
    "security",
    "backup",
    "maintenance",
  ]) {
    await visit(`device settings: ${section}`, `/settings/device?section=${section}`);
  }
  await visit("notification settings", "/settings/notifications");
  await visit("appearance settings", "/settings/appearance");

  const unique = [...new Map(problems.map((p) => [`${p.screen}: ${p.problem}`, p])).keys()];
  expect(unique).toEqual([]);
});
