// Accounts (CR-002 Phase L) in a real browser, on the `auth` instance (MESHTERM_AUTH=local,
// fresh database). Serial: first-run setup happens once, then the other tests sign in.
import { expect, test, type Page } from "@playwright/test";
import { AUTH_PORT } from "./ports.js";

const BASE = `http://127.0.0.1:${AUTH_PORT}`;
const ADMIN = { username: "alice", password: "correct horse battery" };
const VIEWER = { username: "vic", password: "just-looking-123" };

test.describe.configure({ mode: "serial" });

async function signIn(
  page: Page,
  who: { username: string; password: string },
  path = "/dashboard",
) {
  await page.goto(`${BASE}${path}`);
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const menu = (page: Page) => page.locator("[data-mt=user-menu]");

test("first run: create the admin, then the app opens with live data", async ({ page }, info) => {
  // Both projects (desktop, mobile) run this file; only the first one sets up.
  await page.goto(`${BASE}/dashboard`);
  const welcome = page.getByRole("heading", { name: "Welcome to MeshTerm" });
  const signInForm = page.getByRole("heading", { name: "Sign in to MeshTerm" });
  await expect(welcome.or(signInForm)).toBeVisible();
  if (await welcome.isVisible()) {
    await page.getByLabel("Username").fill(ADMIN.username);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
    await page.getByLabel("Repeat password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Create admin account" }).click();
  } else {
    test
      .info()
      .annotations.push({ type: "note", description: `${info.project.name}: already set up` });
    await signIn(page, ADMIN);
  }
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  // The WebSocket authenticated with the session cookie: the node shows as connected.
  await expect(page.locator("[data-mt=status-pill]")).toHaveAttribute("data-mt-state", "connected");
});

test("a deep link survives signing in; signing out returns to the form", async ({ page }) => {
  await signIn(page, ADMIN, "/messages/channel/0");
  await expect(page).toHaveURL(/\/messages\/channel\/0$/);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEditable();
  await menu(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to MeshTerm" })).toBeVisible();
  // The API refuses the old session too.
  expect((await page.request.get(`${BASE}/api/connections`)).status()).toBe(401);
});

test("an admin adds a viewer, who can read but not send; the audit log has it all", async ({
  browser,
}) => {
  const adminPage = await (await browser.newContext()).newPage();
  await signIn(adminPage, ADMIN, "/settings/users");
  const existing = adminPage.locator("[data-mt=users-table]", { hasText: VIEWER.username });
  if ((await existing.count()) === 0) {
    const form = adminPage.locator("[data-mt=settings-form]");
    await form.getByLabel("Username").fill(VIEWER.username);
    await form.getByLabel("Password").fill(VIEWER.password);
    await form.getByLabel("Role").selectOption("viewer");
    await form.getByRole("button", { name: "Add user" }).click();
    await expect(adminPage.locator("[data-mt=users-table]")).toContainText(VIEWER.username);
  }

  const viewerPage = await (await browser.newContext()).newPage();
  await signIn(viewerPage, VIEWER, "/messages/channel/0");
  await expect(viewerPage.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(viewerPage.locator("[data-mt=composer-hint]")).toContainText("Viewers can look");
  // Even a hand-made request is refused (the server enforces roles, not just the UI).
  const csrf = await viewerPage.evaluate(async () => {
    const me = (await (await fetch("/api/auth/me")).json()) as { csrfToken: string };
    return me.csrfToken;
  });
  const status = await viewerPage.evaluate(async (token) => {
    const res = await fetch("/api/connections/1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": token },
      body: JSON.stringify({ text: "sneaky", channel: 0 }),
    });
    return res.status;
  }, csrf);
  expect(status).toBe(403);
  await viewerPage.goto(`${BASE}/settings`);
  await expect(viewerPage.locator("[data-mt=settings-nav]")).not.toContainText("Users");

  await adminPage.goto(`${BASE}/settings/audit`);
  const audit = adminPage.locator("[data-mt=audit-table]");
  await expect(audit).toContainText("user.create");
  await expect(audit).toContainText("login");
  await expect(audit.locator("[data-mt=audit-row][data-mt-state=denied]").first()).toContainText(
    VIEWER.username,
  );
});
