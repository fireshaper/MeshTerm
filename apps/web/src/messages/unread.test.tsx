import { fixtures, type ConversationsDTO, type Message } from "@meshterm/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { byDataMt } from "../test/data-mt.js";
import { TEST_VIEWER } from "../test/me.js";
import { renderApp } from "../test/render-app.js";
import { scenarioChannels, scenarioNodes, SCENARIO_MY_NODE } from "../test/scenario.js";
import { titleFor } from "./unread.js";

const NOW = Date.now();
const RIDGE = 0x0badcafe;
const STATE = { lastReadRxTime: 0, muted: false, favorite: false };

const incoming = (text: string, rxTime: number, id: string): Message => ({
  ...fixtures.inboundMessage,
  id,
  text,
  rxTime,
});
const M1 = incoming("one", NOW - 2_000, "00000000-0000-4000-8000-0000000000a1");
const M2 = incoming("two", NOW - 1_000, "00000000-0000-4000-8000-0000000000a2");

const list = (over: Partial<ConversationsDTO["dms"][number]> = {}): ConversationsDTO => ({
  channels: [
    {
      index: 0,
      name: "LongFast",
      role: "PRIMARY",
      encryption: "default",
      lastMessage: null,
      unread: 3,
      state: { ...STATE, muted: true },
    },
  ],
  dms: [
    {
      peer: RIDGE,
      lastMessage: {
        id: M2.id,
        text: M2.text,
        rxTime: M2.rxTime,
        direction: "in",
        emoji: false,
        pkiEncrypted: false,
        status: null,
      },
      unread: 2,
      state: STATE,
      ignored: false,
      ...over,
    },
  ],
});

const seed = (dms: Partial<ConversationsDTO["dms"][number]> = {}) => ({
  channels: scenarioChannels(),
  nodes: scenarioNodes("default", NOW),
  myNodeNum: SCENARIO_MY_NODE,
  conversationList: list(dms),
  queries: [[queryKeys.messages(1, { peer: RIDGE }), { messages: [M1, M2], cursor: null }]] as [
    readonly unknown[],
    unknown,
  ][],
});

let calls: { url: string; method: string; body: unknown }[] = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null });
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
      if (url.endsWith("/read")) return json({ ...STATE, lastReadRxTime: M2.rxTime });
      if (method === "PATCH") return json({ ...STATE, favorite: true });
      return Promise.resolve(new Response("[]"));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dmRow = () => {
  const row = document.querySelector<HTMLElement>("[data-mt=conversation-row][data-mt-variant=dm]");
  if (!row) throw new Error("no DM row");
  return row;
};

describe("unread", () => {
  it("badges rows and the Messages nav; the title counts what isn't muted", async () => {
    await renderApp("/dashboard", seed());
    const nav = screen.getAllByRole("link", { name: /Messages/ })[0] as HTMLElement;
    const badge = within(nav).getByLabelText("2 unread");
    expect(badge).toHaveTextContent("2");
    // A DM is unread: the badge has priority.
    expect(badge).toHaveAttribute("data-mt-state", "priority");
    expect(document.title).toBe("(2) MeshTerm");
    expect(titleFor(120)).toBe("(99+) MeshTerm");
    expect(titleFor(0)).toBe("MeshTerm");
  });

  it("a row shows its count and state tokens; muted rows are subdued", async () => {
    await renderApp("/messages", seed());
    expect(dmRow()).toHaveAttribute("data-mt-state", "idle unread");
    expect(within(dmRow()).getByLabelText("2 unread")).toBeInTheDocument();
    const channel = document.querySelector("[data-mt=conversation-row][data-mt-variant=channel]");
    expect(channel).toHaveAttribute("data-mt-state", "idle unread muted");
    expect(byDataMt("unread-badge", channel ?? document)).toHaveAttribute(
      "data-mt-variant",
      "muted",
    );
  });

  it("an open thread is marked read after 1 s at the bottom while focused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await renderApp("/messages/dm/!0badcafe", seed());
    await waitFor(
      () => {
        expect(calls.find((c) => c.url.endsWith("/read"))?.body).toEqual({ upTo: M2.rxTime });
      },
      { timeout: 3_000 },
    );
    expect(calls.find((c) => c.url.endsWith("/read"))?.url).toBe(
      `/api/connections/1/conversations/dm/${RIDGE}/read`,
    );
    await waitFor(() => {
      expect(dmRow()).toHaveAttribute("data-mt-state", "active");
    });
    expect(document.title).toBe("MeshTerm");
  });

  it("isn't marked read while the tab is in the background", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await renderApp("/messages/dm/!0badcafe", seed());
    await act(() => new Promise((r) => setTimeout(r, 1_500)));
    expect(calls.filter((c) => c.url.endsWith("/read"))).toEqual([]);
  });

  it("a conversation.read from another browser clears the badge", async () => {
    const { queryClient } = await renderApp("/messages", seed());
    const { applyServerMessage } = await import("../data/apply.js");
    act(() => {
      applyServerMessage(queryClient, {
        type: "conversation.read",
        connectionId: 1,
        kind: "dm",
        key: RIDGE,
        lastReadRxTime: M2.rxTime,
      });
    });
    await waitFor(() => {
      expect(dmRow()).toHaveAttribute("data-mt-state", "idle");
    });
  });

  it("the row menu marks read and favorites; viewers only get Mark read", async () => {
    const user = userEvent.setup();
    await renderApp("/messages", seed());
    await user.click(screen.getByRole("button", { name: "More for RDG" }));
    await user.click(await screen.findByRole("menuitem", { name: "Favorite" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ favorite: true });
    });
    await waitFor(() => {
      expect(dmRow().getAttribute("data-mt-state")).toContain("favorite");
    });
    await user.click(screen.getByRole("button", { name: "More for RDG" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark read" }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith(`/dm/${RIDGE}/read`))).toBe(true);
    });
  });

  it("viewers see only Mark read in the row menu", async () => {
    const user = userEvent.setup();
    await renderApp("/messages", { ...seed(), me: TEST_VIEWER });
    await user.click(screen.getByRole("button", { name: "More for RDG" }));
    expect(await screen.findByRole("menuitem", { name: "Mark read" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Mute|Favorite|Delete/ })).toBeNull();
  });

  it("ignored DMs are hidden unless Show ignored is on", async () => {
    const user = userEvent.setup();
    await renderApp("/messages", seed({ ignored: true }));
    expect(document.querySelector("[data-mt=conversation-row][data-mt-variant=dm]")).toBeNull();
    await user.click(screen.getByLabelText("Show ignored (1)"));
    expect(dmRow()).toBeInTheDocument();
    // Ignored conversations never count toward the title.
    expect(document.title).toBe("MeshTerm");
  });
});
