import type { DashboardDTO } from "@meshterm/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { applyServerMessage } from "../data/apply.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioDashboard, scenarioNodes } from "../test/scenario.js";

const NOW = Date.now();
const RIDGE = 195939070;

const dashboard = (): DashboardDTO => scenarioDashboard("dashboard", NOW);
const renderNodes = () =>
  renderApp("/nodes", {
    dashboard: dashboard(),
    nodes: scenarioNodes("dashboard", NOW),
    myNodeNum: 2712847316,
  });

const sectionNames = (section: string) =>
  [
    ...document.querySelectorAll(
      `[data-mt="card-section"][data-mt-variant="${section}"] [data-mt="node-short-name"]`,
    ),
  ].map((e) => e.textContent);
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-mt="node-row"]')];
const rowFor = (num: number) =>
  document.querySelector<HTMLElement>(`[data-mt="node-row"][data-node-num="${num}"]`);
const cell = (num: number, column: string) =>
  rowFor(num)?.querySelector(`[data-mt="node-${column}"]`);
const headers = () =>
  [...document.querySelectorAll('[data-mt="node-table"] thead th')].map((th) => th.textContent);

beforeEach(() => {
  localStorage.clear();
});

describe("NodesPage", () => {
  it("lists every node as cards: my node, favorites, then everyone else", async () => {
    await renderNodes();
    expectDataMt(byDataMt("node-list"), "node-list", { variant: "cards" });
    expect(byDataMt("page-subtitle")).toHaveTextContent("7 known · 3 heard in the last 15 min");
    expect(sectionNames("self")).toEqual(["MTB"]);
    expect(sectionNames("favorites")).toEqual(["RDG", "HIL"]);
    expect(sectionNames("all")).toEqual(["GAR", "TRL", "KYK", "BIK"]);
  });

  it("filter chips show live counts and narrow the list (CR-005)", async () => {
    const user = userEvent.setup();
    await renderNodes();
    const chip = (name: RegExp) => screen.getByRole("button", { name });
    const count = (variant: string) =>
      document.querySelector(
        `[data-mt="filter-chip"][data-mt-variant="${variant}"] [data-mt="filter-chip-count"]`,
      )?.textContent;
    expect(count("all")).toBe("7");
    expect(count("heard")).toBe("4");
    expect(count("routers")).toBe("2");
    expect(count("silent")).toBe("3");
    await user.click(chip(/^Heard 1 h/));
    expectDataMt(
      document.querySelector('[data-mt="filter-chip"][data-mt-variant="heard"]'),
      "filter-chip",
      { state: "active" },
    );
    expect(sectionNames("all")).toEqual(["GAR", "TRL"]);
    await user.click(chip(/^Routers/));
    expect(sectionNames("favorites")).toEqual(["RDG", "HIL"]);
    expect(sectionNames("all")).toEqual([]);
    // The search narrows the counts too.
    await user.type(screen.getByRole("searchbox", { name: "Search nodes" }), "ridge");
    expect(count("all")).toBe("1");
    expect(count("silent")).toBe("0");
  });

  it("filters by activity, role and power, and searches", async () => {
    const user = userEvent.setup();
    await renderNodes();
    await user.click(screen.getByText("More filters"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "ROUTER");
    expect(sectionNames("favorites")).toEqual(["RDG"]);
    expect(sectionNames("all")).toEqual([]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "");

    await user.selectOptions(screen.getByRole("combobox", { name: "Power" }), "low");
    expect([...sectionNames("favorites"), ...sectionNames("all")]).toEqual(["HIL", "KYK"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Power" }), "unknown");
    expect(sectionNames("all")).toEqual(["BIK"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Power" }), "any");

    await user.click(screen.getByRole("checkbox", { name: "Has position" }));
    expect(sectionNames("all")).toEqual(["GAR", "TRL"]);

    await user.type(screen.getByRole("searchbox", { name: "Search nodes" }), "zzz");
    expect(byDataMt("dashboard-no-match")).toHaveTextContent("No nodes match");
    // Clear filters brings everyone back.
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(sectionNames("all")).toEqual(["GAR", "TRL", "KYK", "BIK"]);
    expect(screen.getByRole("searchbox", { name: "Search nodes" })).toHaveValue("");
  });

  it("only offers roles that exist in the node DB", async () => {
    await renderNodes();
    const options = within(screen.getByRole("combobox", { name: "Role" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "All roles",
      "Client",
      "Client mute",
      "Router",
      "Router late",
      "Tracker",
    ]);
  });

  it("table view: one row per node with chosen columns and Unknown for missing data", async () => {
    const user = userEvent.setup();
    await renderNodes();
    await user.click(screen.getByRole("button", { name: "Table" }));
    expectDataMt(byDataMt("node-list"), "node-list", { variant: "table" });
    expect(screen.getByText("7 nodes")).toBeInTheDocument();
    expect(rows().map((r) => r.dataset.nodeNum)).toEqual([
      "2712847316",
      "195939070",
      "573785173",
      "1584361601",
      "439041101",
      "860116326",
      "1432778632",
    ]);
    expectDataMt(rows()[0] ?? null, "node-row", { state: "self", variant: "online" });
    expect(headers()).toEqual([
      "Favorite",
      "Name",
      "Callsign",
      "Role",
      "Heard",
      "Signal",
      "Hops",
      "Battery",
      "Distance",
      "Hardware",
    ]);
    expect(cell(RIDGE, "battery")).toHaveTextContent("External");
    expect(cell(RIDGE, "signal")).toHaveTextContent("7.25 dB");
    expect(cell(RIDGE, "signal")?.querySelector('[data-mt="signal-bars"]')).not.toBeNull();
    // Heard through relays: the SNR would be the last relay's.
    expect(cell(1584361601, "signal")).toHaveTextContent("relayed");
    expect(cell(RIDGE, "distance")?.querySelector('[data-mt="bearing-point"]')).toHaveTextContent(
      "NE",
    );
    expect(cell(RIDGE, "hops")).toHaveTextContent("Direct");
    expect(cell(RIDGE, "hardware")).toHaveTextContent("RAK WisBlock 4631");
    expect(cell(1432778632, "battery")).toHaveTextContent("Unknown");
    expect(cell(1432778632, "lastHeard")).toHaveTextContent("Never");
    // No signal or DM link for my own node.
    expect(cell(2712847316, "signal")).toHaveTextContent("—");
    expect(within(rows()[0] ?? document.body).queryByRole("link")).toBeNull();
  });

  it("the column picker adds and removes columns and remembers them", async () => {
    const user = userEvent.setup();
    const first = await renderNodes();
    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByText("Columns"));
    await user.click(screen.getByRole("checkbox", { name: "Voltage" }));
    await user.click(screen.getByRole("checkbox", { name: "Hardware" }));
    expect(headers()).toContain("Voltage");
    expect(headers()).not.toContain("Hardware");
    expect(cell(RIDGE, "voltage")).toHaveTextContent("5.10 V");
    first.unmount();

    await renderNodes();
    expectDataMt(byDataMt("node-list"), "node-list", { variant: "table" });
    expect(headers()).toContain("Voltage");
    expect(headers()).not.toContain("Hardware");
  });

  it("table rows update in place when a node is heard again", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderNodes();
    await user.click(screen.getByRole("button", { name: "Table" }));
    const before = new Map(rows().map((r) => [r.dataset.nodeNum, r]));
    const ridge = scenarioNodes("dashboard", NOW).find((n) => n.num === RIDGE);
    if (!ridge) throw new Error("no ridge");
    act(() => {
      applyServerMessage(queryClient, {
        type: "node.upsert",
        node: { ...ridge, shortName: "NEW", snr: 1.5 },
      });
    });
    await waitFor(() => {
      expect(cell(RIDGE, "short")).toHaveTextContent("NEW");
    });
    expect(cell(RIDGE, "signal")).toHaveTextContent("1.5 dB");
    for (const row of rows()) expect(before.get(row.dataset.nodeNum)).toBe(row);
  });

  it("remembers the view, filters and sort after a remount", async () => {
    const user = userEvent.setup();
    const first = await renderNodes();
    await user.click(screen.getByRole("button", { name: /^Favorites/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name");
    await user.click(screen.getByText("More filters"));
    await user.click(screen.getByRole("button", { name: "Compact" }));
    expect(byDataMt("mini-map")).toBeNull();
    first.unmount();

    await renderNodes();
    expect(screen.getByRole("button", { name: /^Favorites/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("name");
    expectDataMt(byDataMt("node-cards"), "node-cards", { variant: "compact" });
    expect(sectionNames("favorites")).toEqual(["HIL", "RDG"]);
  });
});
