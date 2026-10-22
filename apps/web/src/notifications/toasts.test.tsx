import { fixtures, type Message, type NotifyHint } from "@meshterm/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyServerMessage } from "../data/apply.js";
import { queryKeys } from "../data/keys.js";
import { byDataMt } from "../test/data-mt.js";
import { TEST_VIEWER } from "../test/me.js";
import { renderApp } from "../test/render-app.js";
import {
  scenarioChannels,
  scenarioDashboard,
  scenarioNodes,
  SCENARIO_MY_NODE,
} from "../test/scenario.js";
import { resetNotifyCenter, useNotifyCenter } from "./center.js";

const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;
const NOW = Date.now();
const DM: NotifyHint = { level: "notify", reason: "dm", backlog: false };

let n = 0;
const message = (over: Partial<Message> = {}): Message => ({
  ...fixtures.inboundMessage,
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  packetId: 1000 + n,
  rxTime: Date.now(),
  ...over,
});

const seed = () => ({
  dashboard: scenarioDashboard("default", NOW),
  channels: scenarioChannels(),
  nodes: scenarioNodes("default", NOW),
  myNodeNum: SCENARIO_MY_NODE,
});

let calls: { url: string; method: string; body: unknown }[] = [];
beforeEach(() => {
  resetNotifyCenter();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null });
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (url.endsWith("/read")) {
        return json({
          lastReadRxTime: 0,
          muted: false,
          favorite: false,
          notifyLevel: "dm-default",
        });
      }
      if (url.endsWith("/messages") && method === "POST") {
        return json({ message: { ...fixtures.outboundMessage, status: "queued" } }, 201);
      }
      if (url === "/api/me/notification-prefs" && method === "PATCH") {
        return json({ ...(JSON.parse(init?.body as string) as object), quietHours: null });
      }
      return json([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function arrive(qc: QueryClient, m: Message, notify: NotifyHint = DM): void {
  act(() => {
    applyServerMessage(qc, { type: "message.new", message: m, notify });
  });
}

const toasts = () => [
  ...document.querySelectorAll<HTMLElement>("[data-mt=toast-region] [data-mt=toast]"),
];

describe("toasts", () => {
  it("a DM on another page: one toast with the sender, its text and actions", async () => {
    const { queryClient } = await renderApp("/nodes", seed());
    arrive(queryClient, message({ text: "Heading out now" }));
    const [toast] = toasts();
    expect(toast).toHaveAttribute("data-mt-variant", "dm");
    expect(toast).toHaveAttribute("role", "alert");
    expect(toast).toHaveTextContent("RDG · Direct message");
    expect(toast).toHaveTextContent("Heading out now");
    expect(within(toast as HTMLElement).getByRole("button", { name: /Reply/ })).toBeInTheDocument();
  });

  it("groups a conversation's messages and shows at most three, then +N more", async () => {
    const { queryClient } = await renderApp("/nodes", seed());
    arrive(queryClient, message({ text: "one" }));
    arrive(queryClient, message({ text: "two" }));
    arrive(queryClient, message({ text: "three" }));
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toHaveAttribute("data-mt-state", "grouped");
    expect(toasts()[0]).toHaveTextContent("3 new messages from RDG: three");

    for (const peer of [TRAIL, 0x5e6f7081, 0x11111111]) {
      arrive(queryClient, message({ fromNum: peer, peer, text: "hi" }));
    }
    expect(toasts()).toHaveLength(3);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+1 more" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("Mark read marks the conversation read and closes the toast; a read elsewhere does too", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderApp("/nodes", seed());
    arrive(queryClient, message());
    await user.click(screen.getByRole("button", { name: "Mark read" }));
    expect(toasts()).toEqual([]);
    expect(calls.some((c) => c.url === `/api/connections/1/conversations/dm/${RIDGE}/read`)).toBe(
      true,
    );

    arrive(queryClient, message({ fromNum: TRAIL, peer: TRAIL }));
    expect(toasts()).toHaveLength(1);
    act(() => {
      applyServerMessage(queryClient, {
        type: "conversation.read",
        connectionId: 1,
        kind: "dm",
        key: TRAIL,
        lastReadRxTime: Date.now(),
      });
    });
    expect(toasts()).toEqual([]);
  });

  it("inline reply sends within 200 bytes, then says Sent", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderApp("/nodes", seed());
    arrive(queryClient, message());
    await user.click(screen.getByRole("button", { name: /Reply/ }));
    const input = screen.getByRole("textbox", { name: "Reply" });
    await user.type(input, "on my way{Enter}");
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/messages"))?.body).toEqual({
        text: "on my way",
        to: RIDGE,
      });
    });
    expect(await screen.findByText("Sent")).toBeInTheDocument();
  });

  it("viewers get no Reply; reactions and mentions have their own variants", async () => {
    const { queryClient } = await renderApp("/nodes", { ...seed(), me: TEST_VIEWER });
    arrive(queryClient, message({ peer: null, channelIndex: 0, text: "@MTB look" }), {
      level: "notify",
      reason: "mention",
      backlog: false,
    });
    arrive(
      queryClient,
      message({ peer: null, channelIndex: 1, text: "👍", emoji: true, replyId: 9 }),
      {
        level: "notify",
        reason: "reaction",
        backlog: false,
      },
    );
    const [reaction, mention] = toasts();
    expect(mention).toHaveAttribute("data-mt-variant", "mention");
    expect(mention).toHaveTextContent("#LongFast · RDG");
    expect(reaction).toHaveAttribute("data-mt-variant", "reaction");
    expect(reaction).toHaveTextContent("RDG reacted 👍");
    expect(screen.queryByRole("button", { name: /Reply/ })).toBeNull();
  });

  it("the burst after a reconnect is one summary", async () => {
    const { queryClient } = await renderApp("/nodes", seed());
    arrive(queryClient, message(), { ...DM, backlog: true });
    expect(toasts()).toEqual([]);
    act(() => {
      applyServerMessage(queryClient, {
        type: "notifications.backlog",
        connectionId: 1,
        count: 12,
        dmCount: 3,
        conversations: [{ kind: "dm", key: RIDGE, count: 3 }],
      });
    });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toHaveAttribute("data-mt-variant", "backlog");
    expect(toasts()[0]).toHaveTextContent("12 messages arrived while disconnected (3 DMs)");
  });
});

describe("the bell", () => {
  it("counts unread notifications, lists them, and Mark all read clears them", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderApp("/nodes", seed());
    arrive(queryClient, message({ text: "first" }));
    arrive(queryClient, message({ fromNum: TRAIL, peer: TRAIL, text: "second" }));
    const bell = screen.getByRole("button", { name: "Notifications, 2 unread" });
    await user.click(bell);
    const items = await screen.findAllByRole("menuitem", { name: /RDG|TRL/ });
    expect(items.map((i) => i.getAttribute("data-mt-state"))).toEqual(["unread", "unread"]);
    await user.click(screen.getByRole("menuitem", { name: "Mark all read" }));
    expect(useNotifyCenter.getState().events.every((e) => !e.unread)).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/read"))).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("Do Not Disturb for an hour from the bell", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderApp("/nodes", seed());
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await user.click(await screen.findByRole("menuitem", { name: "For 1 hour" }));
    await waitFor(() => {
      const until = (calls.find((c) => c.method === "PATCH")?.body as { dndUntil: number } | null)
        ?.dndUntil;
      expect(until).toBeGreaterThan(Date.now() + 3_500_000);
    });
    await waitFor(() => {
      expect(byDataMt("notification-bell")).toHaveAttribute("data-mt-state", "dnd");
    });
    // During DND: the bell counts, no toast.
    arrive(queryClient, message());
    expect(toasts()).toEqual([]);
    expect(screen.getByRole("button", { name: /Notifications, 1 unread/ })).toBeInTheDocument();
  });
});

describe("mentions", () => {
  it("are highlighted in incoming bubbles, and rows get an @ marker", async () => {
    const m = message({ peer: null, channelIndex: 0, text: "@MTB the gate is open" });
    await renderApp("/messages/channel/0", {
      ...seed(),
      conversations: [[queryKeys.messages(1, { channel: 0 }), { messages: [m], cursor: null }]],
      conversationList: {
        channels: [
          {
            index: 0,
            name: "LongFast",
            role: "PRIMARY",
            encryption: "default",
            lastMessage: null,
            unread: 1,
            unreadMentions: 1,
            state: { lastReadRxTime: 0, muted: false, favorite: false, notifyLevel: "mentions" },
          },
        ],
        dms: [],
      },
    });
    const mark = await screen.findByText("@MTB");
    expect(mark.tagName).toBe("MARK");
    expect(mark).toHaveAttribute("data-mt", "mention");
    expect(screen.getByLabelText("1 mentioning you")).toHaveTextContent("@");
  });
});
