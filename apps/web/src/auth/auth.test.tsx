import type { MeDTO } from "@meshterm/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { createTestRouter } from "../router.js";
import { byDataMt } from "../test/data-mt.js";
import { TEST_VIEWER } from "../test/me.js";
import { renderApp } from "../test/render-app.js";
import { scenarioChannels, scenarioDashboard, scenarioNodes } from "../test/scenario.js";

const SIGNED_OUT: MeDTO = { mode: "local", user: null, csrfToken: "", setupRequired: false };
const NOW = Date.now();

afterEach(() => {
  vi.unstubAllGlobals();
});

/** fetch answering /api/auth/* from a tiny in-memory server. */
function fakeAuthServer(initial: MeDTO) {
  let me = initial;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url === "/api/auth/me") return json(me);
    if (url === "/api/auth/login") {
      const { password } = JSON.parse(init?.body as string) as { password: string };
      if (password !== "right-password") {
        return json({ error: "bad_credentials", message: "wrong username or password" }, 401);
      }
      me = {
        mode: "local",
        user: { id: 1, username: "alice", role: "admin" },
        csrfToken: "tok",
        setupRequired: false,
      };
      return json({ ok: true });
    }
    if (url === "/api/auth/setup") {
      me = {
        mode: "local",
        user: { id: 1, username: "alice", role: "admin" },
        csrfToken: "tok",
        setupRequired: false,
      };
      return json({ ok: true });
    }
    return json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("auth gate", () => {
  it("signed out: the sign-in form, which reports a wrong password and then lets you in", async () => {
    const user = userEvent.setup();
    fakeAuthServer(SIGNED_OUT);
    render(<App router={createTestRouter("/nodes")} live={false} />);
    expect(await screen.findByRole("heading", { name: "Sign in to MeshTerm" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "right-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    // The app opens where the URL pointed.
    expect(await screen.findByRole("heading", { level: 1, name: "Nodes" })).toBeInTheDocument();
  });

  it("first run: setup asks for the first admin and checks the repeat", async () => {
    const user = userEvent.setup();
    const calls = fakeAuthServer({ ...SIGNED_OUT, setupRequired: true });
    render(<App router={createTestRouter("/dashboard")} live={false} />);
    expect(await screen.findByRole("heading", { name: "Welcome to MeshTerm" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "long-enough");
    await user.type(screen.getByLabelText("Repeat password"), "different");
    expect(screen.getByText("The passwords don't match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create admin account" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Repeat password"));
    await user.type(screen.getByLabelText("Repeat password"), "long-enough");
    await user.click(screen.getByRole("button", { name: "Create admin account" }));
    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/auth/setup")).toBe(true);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  });
});

describe("viewer", () => {
  it("can read but not send, favorite or reconnect", async () => {
    await renderApp("/messages/channel/0", {
      me: TEST_VIEWER,
      channels: scenarioChannels(),
      nodes: scenarioNodes("default", NOW),
    });
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(byDataMt("composer-hint")).toHaveTextContent("Viewers can look");
  });

  it("sees disabled stars and no Reconnect on the dashboard", async () => {
    await renderApp("/dashboard", {
      me: TEST_VIEWER,
      dashboard: scenarioDashboard("dashboard", NOW),
    });
    const stars = document.querySelectorAll<HTMLButtonElement>('[data-mt="favorite-toggle"]');
    expect(stars.length).toBeGreaterThan(0);
    for (const s of stars) expect(s).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Reconnect/ })).toBeNull();
  });

  it("the user menu shows who is signed in, without admin links", async () => {
    const user = userEvent.setup();
    await renderApp("/dashboard", {
      me: TEST_VIEWER,
      dashboard: scenarioDashboard("dashboard", NOW),
    });
    await user.click(screen.getByRole("button", { name: "Account: vic (Viewer)" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("vic · Viewer")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Users" })).toBeNull();
  });
});
