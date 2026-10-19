import { BROADCAST_NUM, fixtures, type MeshNode } from "@meshterm/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { applyServerMessage } from "../data/apply.js";
import { queryKeys } from "../data/keys.js";
import { expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { SCENARIO_MY_NODE, scenarioChannels, scenarioNodes } from "../test/scenario.js";
import { compareNodes } from "./NodeTable.js";

const NOW = Date.now();
const RIDGE = 0x0badcafe;
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-mt="node-row"]')];
const rowFor = (num: number) =>
  document.querySelector<HTMLElement>(`[data-mt="node-row"][data-node-num="${num}"]`);

async function renderNodes(nodes: MeshNode[] = scenarioNodes("default", NOW)) {
  return renderApp("/nodes", { nodes, channels: scenarioChannels(), myNodeNum: SCENARIO_MY_NODE });
}

describe("<NodeTable />", () => {
  it("shows the scenario's nodes, most recently heard first, with my node highlighted", async () => {
    await renderNodes();
    expect(rows()).toHaveLength(4);
    expect(screen.getByText("4 nodes")).toBeInTheDocument();
    expect(rows().map((r) => r.querySelector('[data-mt="node-short-name"]')?.textContent)).toEqual([
      "MTB",
      "RDG",
      "TRL",
      "GAR",
    ]);
    expectDataMt(rows()[0] ?? null, "node-row", { state: "self" });
    expectDataMt(rows()[1] ?? null, "node-row", { state: "other" });

    const ridge = within(rowFor(RIDGE) ?? document.body);
    expect(ridge.getByRole("link", { name: "Ridge Repeater" })).toBeInTheDocument();
    expect(rowFor(RIDGE)?.querySelector('[data-mt="node-id"]')).toHaveTextContent("!0badcafe");
    expect(rowFor(RIDGE)?.querySelector('[data-mt="node-hardware"]')).toHaveTextContent("RAK4631");
    expect(rowFor(RIDGE)?.querySelector('[data-mt="node-last-heard"]')).toHaveTextContent(
      "45 seconds ago",
    );
    expect(rowFor(RIDGE)?.querySelector('[data-mt="node-snr"]')).toHaveTextContent("7.25 dB");
    expect(rowFor(RIDGE)?.querySelector('[data-mt="node-hops"]')).toHaveTextContent("0");
    // No SNR for yourself (firmware reports 0), and no DM link.
    expect(rows()[0]?.querySelector('[data-mt="node-snr"]')).toHaveTextContent("—");
    expect(within(rows()[0] ?? document.body).queryByRole("link")).toBeNull();
  });

  it("a node.upsert updates its row in place: every row keeps its DOM element", async () => {
    const { queryClient } = await renderNodes();
    const before = new Map(rows().map((r) => [r.dataset.nodeNum, r]));
    const ridge = scenarioNodes("default", NOW).find((n) => n.num === RIDGE);
    if (!ridge) throw new Error("no ridge");

    act(() => {
      applyServerMessage(queryClient, {
        type: "node.upsert",
        node: { ...ridge, shortName: "NEW", snr: 1.5 },
      });
    });
    await waitFor(() => {
      expect(rowFor(RIDGE)?.querySelector('[data-mt="node-short-name"]')).toHaveTextContent("NEW");
    });
    expect(rowFor(RIDGE)?.querySelector('[data-mt="node-snr"]')).toHaveTextContent("1.5 dB");
    for (const row of rows()) expect(before.get(row.dataset.nodeNum)).toBe(row);
  });

  it("re-sorts when a node is heard more recently, still reusing row elements", async () => {
    const { queryClient } = await renderNodes();
    const before = new Map(rows().map((r) => [r.dataset.nodeNum, r]));
    const garage = scenarioNodes("default", NOW).find((n) => n.shortName === "GAR");
    if (!garage) throw new Error("no garage");
    act(() => {
      applyServerMessage(queryClient, {
        type: "node.upsert",
        node: { ...garage, lastHeard: NOW + 1_000 },
      });
    });
    await waitFor(() => {
      expect(rows()[0]?.querySelector('[data-mt="node-short-name"]')).toHaveTextContent("GAR");
    });
    for (const row of rows()) expect(before.get(row.dataset.nodeNum)).toBe(row);
  });

  it("clicking a row opens the DM with that node", async () => {
    const { router } = await renderNodes();
    const row = rowFor(RIDGE);
    if (!row) throw new Error("no row");
    await userEvent.click(row.querySelector('[data-mt="node-hops"]') ?? row);
    await act(() => router.load());
    expect(router.state.location.pathname).toBe(`/dm/${RIDGE}`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Direct messages with Ridge Repeater",
    );
  });

  it("sorts never-heard nodes last", () => {
    const a = { ...fixtures.node, num: 1, lastHeard: null };
    const b = { ...fixtures.node, num: 2, lastHeard: 5 };
    const c = { ...fixtures.node, num: 3, lastHeard: 9 };
    expect([a, b, c].sort(compareNodes).map((n) => n.num)).toEqual([3, 2, 1]);
  });
});

describe("DM page", () => {
  it("shows the DM conversation and sends with to", async () => {
    const dm = {
      ...fixtures.inboundMessage,
      id: "00000000-0000-4000-8000-00000000d001",
      fromNum: RIDGE,
      toNum: SCENARIO_MY_NODE,
      peer: RIDGE,
      text: "psst",
      rxTime: NOW - 1_000,
    };
    const channelMsg = {
      ...dm,
      id: "00000000-0000-4000-8000-00000000c001",
      toNum: BROADCAST_NUM,
      peer: null,
      text: "everyone",
    };
    await renderApp(`/dm/${RIDGE}`, {
      nodes: scenarioNodes("default", NOW),
      myNodeNum: SCENARIO_MY_NODE,
      conversations: [
        [queryKeys.messages(1, { peer: RIDGE }), { messages: [dm], cursor: null }],
        [queryKeys.messages(1, { channel: 0 }), { messages: [channelMsg], cursor: null }],
      ],
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ridge Repeater");
    expect(screen.getByText("psst")).toBeInTheDocument();
    expect(screen.queryByText("everyone")).toBeNull();
  });
});
