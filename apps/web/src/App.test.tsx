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
    expectDataMt(byDataMt("status-pill"), "status-pill", { state: "unknown" });
    expectDataMt(byDataMt("main"), "main");
    // The sidebar (≥ 768 px) and the drawer's menu button (< 768 px); CSS shows one.
    expectDataMt(byDataMt("sidebar"), "sidebar");
    expectDataMt(byDataMt("menu-button"), "menu-button");
    expectDataMt(byDataMt("app-shell"), "app-shell", { state: "auto" });
  });

  it("opens the navigation drawer, which closes after choosing a page", async () => {
    const user = userEvent.setup();
    const router = await renderAt("/messages/channel/0");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog");
    expectDataMt(drawer, "nav-drawer");
    await user.click(within(drawer).getByRole("link", { name: "Nodes" }));
    await act(() => router.load());
    expect(router.state.location.pathname).toBe("/nodes");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the drawer closes with Escape", async () => {
    const user = userEvent.setup();
    await renderAt("/messages/channel/0");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("collapses and expands the sidebar, and remembers the choice", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const first = render(
      <App router={createTestRouter("/messages/channel/0")} live={false} me={TEST_ADMIN} />,
    );
    await screen.findByRole("heading", { level: 1 });
    // jsdom matches no media query: auto reads as collapsed, so the toggle expands.
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expectDataMt(byDataMt("app-shell"), "app-shell", { state: "expanded" });
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expectDataMt(byDataMt("app-shell"), "app-shell", { state: "collapsed" });
    first.unmount();
    render(<App router={createTestRouter("/messages/channel/0")} live={false} me={TEST_ADMIN} />);
    await screen.findByRole("heading", { level: 1 });
    expectDataMt(byDataMt("app-shell"), "app-shell", { state: "collapsed" });
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    localStorage.clear();
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
    const sidebar = byDataMt("sidebar");
    if (!sidebar) throw new Error("no sidebar");
    const nodesLink = sidebar.querySelector<HTMLElement>('a[href="/nodes"]');
    const messagesLink = sidebar.querySelector<HTMLElement>('a[href="/messages"]');
    expectDataMt(messagesLink, "nav-item", { state: "active" });
    expectDataMt(nodesLink, "nav-item", { state: "inactive" });

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
