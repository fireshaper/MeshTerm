import type { DashboardDTO } from "@meshterm/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioDashboard } from "../test/scenario.js";

const NOW = Date.now();

function dashboard(change: (d: DashboardDTO) => void = () => undefined): DashboardDTO {
  const d = scenarioDashboard("dashboard", NOW);
  change(d);
  return d;
}

const tile = (variant: string) =>
  document.querySelector<HTMLElement>(`[data-mt="status-tile"][data-mt-variant="${variant}"]`);
const tileValue = (variant: string) =>
  tile(variant)?.querySelector('[data-mt="status-tile-value"]')?.textContent;
const shortNames = (section: string) =>
  [
    ...document.querySelectorAll(
      `[data-mt="card-section"][data-mt-variant="${section}"] [data-mt="node-short-name"]`,
    ),
  ].map((e) => e.textContent);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DashboardPage", () => {
  it("loads everything with one API call", async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(new Response(JSON.stringify(dashboard()), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderApp("/dashboard");
    await screen.findAllByRole("article");
    expect(screen.getAllByRole("article")).toHaveLength(7);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/connections/1/dashboard"]);
    expectDataMt(byDataMt("dashboard"), "dashboard", { variant: "comfy" });
  });

  it("shows the status strip with ok/warn/danger states", async () => {
    await renderApp("/dashboard", {
      dashboard: dashboard((d) => {
        const self = d.nodes.find((n) => n.isSelf);
        if (self?.device) {
          self.device.channelUtil = 26; // warn above 25
          self.device.airUtilTx = 10.5; // danger above 10
        }
        d.summary.messages24h = 58;
      }),
    });
    expectDataMt(byDataMt("status-strip"), "status-strip");
    expectDataMt(tile("connection"), "status-tile", { state: "ok" });
    expect(tileValue("connection")).toBe("Connected 1h");
    // Online = heard < 15 min: MTB (now), RDG (2 min), GAR (10 min).
    expect(tileValue("nodes-online")).toBe("3/7");
    expectDataMt(tile("my-power"), "status-tile", { state: "ok" });
    expect(tileValue("my-power")).toBe("87%");
    expectDataMt(tile("channel-util"), "status-tile", { state: "warn" });
    expect(tileValue("channel-util")).toBe("26%");
    expectDataMt(tile("air-util-tx"), "status-tile", { state: "danger" });
    expect(tileValue("air-util-tx")).toBe("10.5%");
    expect(tileValue("messages")).toBe("58");
    expect(tileValue("last-packet")).toBe("4 s ago");
  });

  it("shows Powered, and warn/danger for a low or critical own battery", async () => {
    const withBattery = (level: number) =>
      dashboard((d) => {
        const self = d.nodes.find((n) => n.isSelf);
        if (self?.device) self.device.batteryLevel = level;
      });
    const { queryClient } = await renderApp("/dashboard", { dashboard: withBattery(101) });
    expect(tileValue("my-power")).toBe("Powered");
    queryClient.setQueryData(queryKeys.dashboard(1), withBattery(15));
    await waitFor(() => {
      expectDataMt(tile("my-power"), "status-tile", { state: "warn" });
    });
    queryClient.setQueryData(queryKeys.dashboard(1), withBattery(9));
    await waitFor(() => {
      expectDataMt(tile("my-power"), "status-tile", { state: "danger" });
    });
  });

  it("clicking Nodes online sets the Online filter", async () => {
    const user = userEvent.setup();
    await renderApp("/dashboard", { dashboard: dashboard() });
    await user.click(within(tile("nodes-online") as HTMLElement).getByRole("button"));
    expect(screen.getByRole("button", { name: "Online" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("pins my node and favorites, and filters, sorts and searches", async () => {
    const user = userEvent.setup();
    await renderApp("/dashboard", { dashboard: dashboard() });
    expect(shortNames("self")).toEqual(["MTB"]);
    expect(shortNames("favorites")).toEqual(["RDG", "HIL"]);
    expect(shortNames("all")).toEqual(["GAR", "TRL", "KYK", "BIK"]);

    await user.selectOptions(screen.getByRole("combobox"), "Battery");
    expect(shortNames("all")).toEqual(["KYK", "TRL", "GAR", "BIK"]);

    await user.click(screen.getByRole("button", { name: "Has position" }));
    expect(shortNames("all")).toEqual(["TRL", "GAR"]);
    expectDataMt(screen.getByRole("button", { name: "Has position" }), "segment", {
      state: "active",
      variant: "position",
    });

    await user.type(screen.getByRole("searchbox", { name: "Search nodes" }), "zzz");
    expect(byDataMt("dashboard-no-match")).toHaveTextContent("No nodes match");
  });

  it("remembers filter, sort and density after a remount", async () => {
    const user = userEvent.setup();
    const first = await renderApp("/dashboard", { dashboard: dashboard() });
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    await user.selectOptions(screen.getByRole("combobox"), "Name");
    await user.click(screen.getByRole("button", { name: "Compact" }));
    expect(byDataMt("mini-map")).toBeNull(); // compact hides maps
    first.unmount();

    await renderApp("/dashboard", { dashboard: dashboard() });
    expect(screen.getByRole("button", { name: "Favorites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("combobox")).toHaveValue("name");
    expectDataMt(byDataMt("dashboard"), "dashboard", { variant: "compact" });
    expect(shortNames("favorites")).toEqual(["HIL", "RDG"]);
  });

  it("shows an empty state before the node DB has anything", async () => {
    await renderApp("/dashboard", { dashboard: dashboard((d) => (d.nodes = [])) });
    expectDataMt(byDataMt("dashboard-empty"), "dashboard-empty");
    expect(byDataMt("dashboard-empty")).toHaveTextContent("config handshake");
  });

  it("toggles a favorite at once and asks the server", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ node: {} }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderApp("/dashboard", { dashboard: dashboard() });
    await user.click(screen.getByRole("button", { name: "Favorite Garage Station" }));
    expect(shortNames("favorites")).toEqual(["RDG", "GAR", "HIL"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/connections/1/nodes/1584361601/favorite",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ favorite: true }) }),
    );
  });

  it("flips a favorite back when the server refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "not_found", message: "x" }), { status: 404 }),
        ),
      ),
    );
    await renderApp("/dashboard", { dashboard: dashboard() });
    await user.click(screen.getByRole("button", { name: "Unfavorite Ridge Repeater" }));
    await waitFor(() => {
      expect(shortNames("favorites")).toEqual(["RDG", "HIL"]);
    });
  });
});
