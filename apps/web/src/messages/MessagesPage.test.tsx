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
      unreadMentions: 0,
      state: { lastReadRxTime: 0, muted: false, favorite: false, notifyLevel: "dm-default" },
    },
    {
      index: 1,
      name: "Friends",
      role: "SECONDARY",
      encryption: "custom",
      lastMessage: null,
      unread: 0,
      unreadMentions: 0,
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
        fromNum: RIDGE,
        emoji: false,
        pkiEncrypted: true,
        status: null,
      },
      unread: 0,
      unreadMentions: 0,
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
        fromNum: 0xa1b2c3d4,
        emoji: false,
        pkiEncrypted: false,
        status: "acked",
      },
      unread: 0,
      unreadMentions: 0,
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

const byDataMtIn = (root: Element, name: string) => root.querySelector(`[data-mt="${name}"]`);
const rows = (variant: string) => [
  ...document.querySelectorAll<HTMLElement>(
    `[data-mt=conversation-row][data-mt-variant=${variant}]`,
  ),
];

describe("Messages view", () => {
  it("lists every channel and every DM, with the open one active", async () => {
    await renderApp("/messages/channel/1", seed());
    expectDataMt(byDataMt("messages-view"), "messages-view", { state: "thread" });
    expect(
      rows("channel").map((r) => r.querySelector('[data-mt="conversation-name"]')?.textContent),
    ).toEqual(["#LongFast", "#Friends"]);
    expect(rows("channel").map((r) => byDataMtIn(r, "conversation-tile")?.textContent)).toEqual([
      "CH0",
      "CH1",
    ]);
    expect(
      within(rows("channel")[1] as HTMLElement).getByLabelText("Private channel"),
    ).toBeVisible();
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

    expect(screen.getByRole("heading", { level: 2, name: "Friends" })).toBeInTheDocument();
    expectDataMt(byDataMt("encryption-badge"), "encryption-badge", { variant: "channel" });
  });

  it("channel rows preview the last message with its sender's callsign", async () => {
    const withLast: ConversationsDTO = {
      ...list,
      channels: list.channels.map((c) =>
        c.index === 0
          ? {
              ...c,
              lastMessage: {
                id: "00000000-0000-4000-8000-000000000009",
                text: "Heading out",
                rxTime: NOW - 60_000,
                direction: "in",
                fromNum: RIDGE,
                emoji: false,
                pkiEncrypted: false,
                status: null,
              },
            }
          : c,
      ),
    };
    await renderApp("/messages/channel/1", { ...seed(), conversationList: withLast });
    expect(rows("channel")[0]).toHaveTextContent("RDG: Heading out");
  });

  it("the filter shows all, channels only or direct messages only", async () => {
    const user = userEvent.setup();
    await renderApp("/messages/channel/0", seed());
    const filter = within(byDataMt("conversation-filter") as HTMLElement);
    expect(filter.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    await user.click(filter.getByRole("button", { name: "Direct" }));
    expect(screen.queryByRole("region", { name: "Channels" })).toBeNull();
    expect(screen.getByRole("region", { name: "Direct messages" })).toBeInTheDocument();
    await user.click(filter.getByRole("button", { name: "Channels" }));
    expect(screen.getByRole("region", { name: "Channels" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Direct messages" })).toBeNull();
  });

  it("a channel thread names its key and who was heard this hour", async () => {
    await renderApp("/messages/channel/0", seed());
    expect(screen.getByRole("heading", { level: 2, name: "LongFast" })).toBeInTheDocument();
    expect(byDataMt("thread-details")).toHaveTextContent("Channel 0");
    expectDataMt(byDataMt("encryption-badge"), "encryption-badge", { variant: "default" });
    expect(byDataMt("encryption-badge")).toHaveTextContent("Default key, public");
    expect(byDataMt("thread-heard")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/^\d+ nodes heard this hour$/),
    );
    expect(byDataMt("composer-destination")).toHaveTextContent("CH 0 · LongFast");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute(
      "placeholder",
      "Message LongFast",
    );
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
    expect(byDataMt("encryption-badge")).toHaveTextContent("Public-key encrypted");
    await user.click(screen.getByRole("button", { name: "Node details" }));
    expect(await screen.findByRole("dialog", { name: "Ridge Repeater" })).toBeInTheDocument();
  });

  it("a DM with a node without a public key warns about channel encryption", async () => {
    await renderApp("/messages/dm/!1a2b3c4d", seed());
    expectDataMt(byDataMt("encryption-badge"), "encryption-badge", { variant: "channel" });
    expect(byDataMt("encryption-badge")).toHaveTextContent("Channel key only");
    expect(byDataMt("composer-destination")).toHaveTextContent("DM · TRL");
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
