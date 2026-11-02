import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { createTestRouter } from "./router.js";
import { byDataMt, expectDataMt } from "./test/data-mt.js";
import { TEST_ADMIN } from "./test/me.js";

async function renderAt(path: string) {
  const router = createTestRouter(path);
  render(<App router={router} live={false} me={TEST_ADMIN} />);
  await screen.findByRole("heading", { level: 1 });
  return router;
}

describe("<App /> shell", () => {
  it("renders the shell with its theming hooks", async () => {
    await renderAt("/messages/channel/0");
    expectDataMt(byDataMt("app-shell"), "app-shell");
    expectDataMt(byDataMt("header"), "header");
    expectDataMt(byDataMt("tab-nav"), "tab-nav");
    expectDataMt(byDataMt("header-actions"), "header-actions");
    expectDataMt(byDataMt("status-band"), "status-band");
    expectDataMt(byDataMt("status-pill"), "status-pill", { state: "unknown" });
    expectDataMt(byDataMt("main"), "main");
    // The sidebar and the phone drawer are gone (CR-005): one navigation, as tabs.
    expect(byDataMt("sidebar")).toBeNull();
    expect(byDataMt("menu-button")).toBeNull();
    expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(1);
  });

  it("redirects / to the dashboard", async () => {
    const router = await renderAt("/");
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dashboard");
    expectDataMt(byDataMt("dashboard"), "dashboard");
  });

  it.each([
    ["/messages/channel/3", "messages-view", "Messages"],
    ["/nodes", "node-list", "Nodes"],
    ["/messages/dm/!0badcafe", "messages-view", "Messages"],
    ["/nope", "not-found", "Page not found"],
  ])("renders the placeholder for %s", async (path, hook, title) => {
    await renderAt(path);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    expectDataMt(byDataMt(hook), hook);
  });

  it("navigates with the nav links and marks the active one", async () => {
    const router = await renderAt("/messages/channel/0");
    const tabs = byDataMt("tab-nav");
    if (!tabs) throw new Error("no tabs");
    const nodesLink = tabs.querySelector<HTMLElement>('a[href="/nodes"]');
    const messagesLink = tabs.querySelector<HTMLElement>('a[href="/messages"]');
    expectDataMt(messagesLink, "nav-item", { state: "active", variant: "tab" });
    expectDataMt(nodesLink, "nav-item", { state: "inactive", variant: "tab" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Dashboard", "Messages", "Map", "Nodes", "Settings"]);

    if (!nodesLink) throw new Error("no nodes link");
    await userEvent.click(nodesLink);
    await act(() => router.load());
    expect(router.state.location.pathname).toBe("/nodes");
    expectDataMt(nodesLink, "nav-item", { state: "active" });
    expect(nodesLink).toHaveAttribute("aria-current", "page");
  });
});

describe("old message routes", () => {
  it.each([
    ["/channels/1", "/messages/channel/1"],
    ["/dm/195939070", "/messages/dm/!0badcafe"],
    ["/dm/not-a-node", "/messages"],
  ])("%s redirects to %s", async (from, to) => {
    const router = await renderAt(from);
    expect(router.state.location.pathname).toBe(to);
    expectDataMt(byDataMt("messages-view"), "messages-view");
  });
});
