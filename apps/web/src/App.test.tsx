import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { parseNodeNum } from "./pages/DmPage.js";
import { createTestRouter } from "./router.js";
import { byDataMt, expectDataMt } from "./test/data-mt.js";

async function renderAt(path: string) {
  const router = createTestRouter(path);
  render(<App router={router} live={false} />);
  await screen.findByRole("heading", { level: 1 });
  return router;
}

describe("<App /> shell", () => {
  it("renders the shell with its theming hooks", async () => {
    await renderAt("/channels/0");
    expectDataMt(byDataMt("app-shell"), "app-shell");
    expectDataMt(byDataMt("header"), "header");
    expectDataMt(byDataMt("status-pill"), "status-pill", { state: "unknown" });
    expectDataMt(byDataMt("main"), "main");
    // Both navigations exist; CSS decides which one shows.
    expectDataMt(byDataMt("sidebar"), "sidebar");
    expectDataMt(byDataMt("tab-bar"), "tab-bar");
  });

  it("redirects / to the dashboard", async () => {
    const router = await renderAt("/");
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dashboard");
    expectDataMt(byDataMt("dashboard"), "dashboard");
  });

  it.each([
    ["/channels/3", "channel-view", "Channel 3"],
    ["/nodes", "node-list", "Nodes"],
    ["/dm/195939070", "dm-view", "Direct messages with !0badcafe"],
    ["/dm/not-a-node", "dm-view", "Unknown node"],
    ["/nope", "not-found", "Page not found"],
  ])("renders the placeholder for %s", async (path, hook, title) => {
    await renderAt(path);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    expectDataMt(byDataMt(hook), hook);
  });

  it("navigates with the nav links and marks the active one", async () => {
    const router = await renderAt("/channels/0");
    const sidebar = byDataMt("sidebar");
    if (!sidebar) throw new Error("no sidebar");
    const nodesLink = sidebar.querySelector<HTMLElement>('a[href="/nodes"]');
    const channelsLink = sidebar.querySelector<HTMLElement>('a[href="/channels/0"]');
    expectDataMt(channelsLink, "nav-item", { state: "active" });
    expectDataMt(nodesLink, "nav-item", { state: "inactive" });

    if (!nodesLink) throw new Error("no nodes link");
    await userEvent.click(nodesLink);
    await act(() => router.load());
    expect(router.state.location.pathname).toBe("/nodes");
    expectDataMt(nodesLink, "nav-item", { state: "active" });
    expect(nodesLink).toHaveAttribute("aria-current", "page");
  });
});

describe("parseNodeNum", () => {
  it.each([
    ["195939070", 195939070],
    ["1", 1],
    ["0", null],
    ["4294967295", null],
    ["-5", null],
    ["12abc", null],
    ["99999999999", null],
  ])("%s → %s", (param, expected) => {
    expect(parseNodeNum(param)).toBe(expected);
  });
});
