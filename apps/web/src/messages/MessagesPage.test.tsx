import type { ConversationsDTO } from "@meshterm/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../data/keys.js";
import { renderApp } from "../test/render-app.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import {
  SCENARIO_MY_NODE,
  scenarioChannels,
  scenarioDashboard,
  scenarioNodeDetail,
  scenarioNodes,
} from "../test/scenario.js";

const NOW = Date.now();
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;

const list: ConversationsDTO = {
  channels: [
    {
      index: 0,
      name: "LongFast",
      role: "PRIMARY",
      encryption: "default",
      lastMessage: null,
      unread: 0,
      state: { lastReadRxTime: 0, muted: false, favorite: false, notifyLevel: "dm-default" },
    },
    {
      index: 1,
      name: "Friends",
      role: "SECONDARY",
      encryption: "custom",
      lastMessage: null,
      unread: 0,
      state: { lastReadRxTime: 0, muted: false, favorite: false, notifyLevel: "dm-default" },
    },
  ],
  dms: [
    {
      peer: RIDGE,
      lastMessage: {
        id: "00000000-0000-4000-8000-000000000001",
        text: "Hey, you around?",
        rxTime: NOW - 60_000,
        direction: "in",
        emoji: false,
        pkiEncrypted: true,
        status: null,
      },
      unread: 0,
      state: { lastReadRxTime: 0, muted: false, favorite: false, notifyLevel: "dm-default" },
      ignored: false,
    },
    {
      peer: TRAIL,
      lastMessage: {
        id: "00000000-0000-4000-8000-000000000002",
        text: "Thanks!",
        rxTime: NOW - 3600_000,
        direction: "out",
        emoji: false,
        pkiEncrypted: false,
        status: "acked",
      },
      unread: 0,
      state: { lastReadRxTime: 0, muted: false, favorite: false, notifyLevel: "dm-default" },
      ignored: false,
    },
  ],
};

const seed = () => ({
  channels: scenarioChannels(),
  nodes: scenarioNodes("default", NOW),
  myNodeNum: SCENARIO_MY_NODE,
  conversationList: list,
});

const rows = (variant: string) => [
  ...document.querySelectorAll<HTMLElement>(
    `[data-mt=conversation-row][data-mt-variant=${variant}]`,
  ),
];

describe("Messages view", () => {
  it("lists every channel and every DM, with the open one active", async () => {
    await renderApp("/messages/channel/1", seed());
    expectDataMt(byDataMt("messages-view"), "messages-view", { state: "thread" });
    expect(rows("channel").map((r) => r.textContent)).toEqual(["#LongFast", "#Friends"]);
    expectDataMt(rows("channel")[1] ?? null, "conversation-row", {
      variant: "channel",
      state: "active",
    });

    const [ridge, trail] = rows("dm");
    expect(ridge).toHaveTextContent("RDG");
    expect(ridge).toHaveTextContent("Ridge Repeater");
    expect(ridge).toHaveTextContent("Hey, you around?");
    expect(within(ridge as HTMLElement).getByLabelText("End-to-end encrypted")).toBeInTheDocument();
    expect(trail).toHaveTextContent("You: Thanks!");
    expect(ridge).toHaveAttribute("href", "/messages/dm/!0badcafe");

    expect(screen.getByRole("heading", { level: 2, name: "#Friends" })).toBeInTheDocument();
    expectDataMt(byDataMt("encryption-badge"), "encryption-badge", { variant: "channel" });
  });

  it("search filters both sections by name or node id", async () => {
    const user = userEvent.setup();
    await renderApp("/messages/channel/0", seed());
    await user.type(screen.getByRole("searchbox", { name: "Search conversations" }), "!1a2b");
    expect(rows("dm")).toHaveLength(1);
    expect(rows("dm")[0]).toHaveTextContent("TRL");
    expect(rows("channel")).toHaveLength(0);
  });

  it("a DM thread shows the peer, its encryption and opens the node drawer", async () => {
    const user = userEvent.setup();
    await renderApp("/messages/dm/!0badcafe", {
      ...seed(),
      dashboard: scenarioDashboard("default", NOW),
      queries: [[queryKeys.nodeDetail(1, RIDGE), scenarioNodeDetail(RIDGE, "default", NOW)]],
    });
    const header = byDataMt("thread-header");
    expectDataMt(header, "thread-header", { variant: "dm" });
    expect(header).toHaveTextContent("Ridge Repeater");
    expect(header).toHaveTextContent("!0badcafe");
    expectDataMt(byDataMt("encryption-badge"), "encryption-badge", { variant: "pki" });
    await user.click(screen.getByRole("button", { name: "Node details" }));
    expect(await screen.findByRole("dialog", { name: "Ridge Repeater" })).toBeInTheDocument();
  });

  it("a DM with a node without a public key warns about channel encryption", async () => {
    await renderApp("/messages/dm/!1a2b3c4d", seed());
    expectDataMt(byDataMt("encryption-badge"), "encryption-badge", { variant: "channel" });
    expect(byDataMt("encryption-badge")).toHaveTextContent("Channel key");
  });

  it("New opens a node picker; picking a node opens its DM thread", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp("/messages/channel/0", seed());
    await user.click(screen.getByRole("button", { name: "New" }));
    const picker = await screen.findByRole("dialog", { name: "New direct message" });
    const items = within(picker)
      .getAllByRole("button")
      .filter((b) => b.dataset.nodeNum);
    // Not ourselves; Garden has no key and hasn't been heard for a day.
    expect(items.map((b) => Number(b.dataset.nodeNum))).not.toContain(SCENARIO_MY_NODE);
    const garden = items.find((b) => b.textContent.includes("GAR"));
    expect(garden).toHaveTextContent("No public key");
    await user.click(items.find((b) => b.textContent.includes("TRL")) as HTMLElement);
    await act(() => router.load());
    expect(router.state.location.pathname).toBe("/messages/dm/!1a2b3c4d");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("/messages on a phone shows the list only", async () => {
    await renderApp("/messages", seed());
    expectDataMt(byDataMt("messages-view"), "messages-view", { state: "list" });
    expect(screen.getByText("Pick a conversation.")).toBeInTheDocument();
  });
});
