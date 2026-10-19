import { BROADCAST_NUM, fixtures, type Message } from "@meshterm/shared";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { SCENARIO_MY_NODE, scenarioChannels, scenarioNodes } from "../test/scenario.js";

const RIDGE = 0x0badcafe;
const NOW = Date.now();

function channelMessages(count: number, start = 0): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    ...fixtures.inboundMessage,
    id: `00000000-0000-4000-8000-${String(start + i).padStart(12, "0")}`,
    packetId: start + i + 1,
    fromNum: RIDGE,
    toNum: BROADCAST_NUM,
    peer: null,
    channelIndex: 0,
    text: `message ${start + i}`,
    rxTime: NOW - (count - i) * 60_000,
  }));
}

const channel0 = queryKeys.messages(1, { channel: 0 });
const seedBase = () => ({
  channels: scenarioChannels(),
  nodes: scenarioNodes("default", NOW),
  myNodeNum: SCENARIO_MY_NODE,
});
const rendered = () => document.querySelectorAll('[data-mt="message"]');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<MessageList />", () => {
  it("virtualizes: 5,000 messages render fewer than 100 elements", async () => {
    await renderApp("/channels/0", {
      ...seedBase(),
      conversations: [[channel0, { messages: channelMessages(5_000), cursor: null }]],
    });
    expectDataMt(byDataMt("message-list"), "message-list", { state: "ready" });
    expect(rendered().length).toBeGreaterThan(0);
    expect(rendered().length).toBeLessThan(100);
  });

  it("shows sender short name, text, relative time and in/out hooks", async () => {
    const inbound = channelMessages(1)[0] as Message;
    await renderApp("/channels/0", {
      ...seedBase(),
      conversations: [[channel0, { messages: [inbound], cursor: null }]],
    });
    const el = document.querySelector<HTMLElement>('[data-mt="message"]');
    expectDataMt(el, "message", { variant: "in", state: "received" });
    expect(el?.querySelector('[data-mt="message-sender"]')).toHaveTextContent("RDG");
    expect(el?.querySelector('[data-mt="message-text"]')).toHaveTextContent("message 0");
    expect(el?.querySelector('[data-mt="message-time"]')).toHaveTextContent("1 minute ago");
    expect(el?.querySelector('[data-mt="message-status"]')).toBeNull();
  });

  it("an outbound message shows its status", async () => {
    const out: Message = {
      ...fixtures.outboundMessage,
      id: "0e6c2f1a-3b4d-4e5f-8a9b-000000000001",
      fromNum: SCENARIO_MY_NODE,
      rxTime: NOW,
      status: "sent",
    };
    const { queryClient } = await renderApp("/channels/0", {
      ...seedBase(),
      conversations: [[channel0, { messages: [out], cursor: null }]],
    });
    const el = () => document.querySelector<HTMLElement>('[data-mt="message"]');
    expectDataMt(el(), "message", { variant: "out", state: "sent" });
    expect(el()?.querySelector('[data-mt="message-sender"]')).toHaveTextContent("MTB");
    expectDataMt(el()?.querySelector('[data-mt="message-status"]') ?? null, "message-status", {
      state: "sent",
    });
    expect(el()?.querySelector('[data-mt="message-status"]')).toHaveTextContent("Sent");

    act(() => {
      queryClient.setQueryData(channel0, { messages: [{ ...out, status: "acked" }], cursor: null });
    });
    await waitFor(() => {
      expect(el()?.querySelector('[data-mt="message-status"]')).toHaveTextContent("Acknowledged");
    });
  });

  it("scrolling to the top fetches exactly one older page with the right before", async () => {
    const page = channelMessages(50, 1_000);
    const cursor = `${String(page[0]?.rxTime)}_${page[0]?.id ?? ""}`;
    const older = channelMessages(10, 0).reverse(); // REST pages are newest first
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messages: older, nextCursor: null }), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient } = await renderApp("/channels/0", {
      ...seedBase(),
      conversations: [[channel0, { messages: page, cursor }]],
    });
    const list = byDataMt("message-list");
    if (!list) throw new Error("no list");
    list.scrollTop = 0;
    fireEvent.scroll(list);
    fireEvent.scroll(list);

    await waitFor(() => {
      expect(queryClient.getQueryData<{ messages: Message[] }>(channel0)?.messages).toHaveLength(
        60,
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0 as never]), "http://x");
    expect(url.pathname).toBe("/api/connections/1/messages");
    expect(url.searchParams.get("channel")).toBe("0");
    expect(url.searchParams.get("before")).toBe(cursor);

    // Nothing older now: further scrolling fetches nothing.
    fireEvent.scroll(list);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Start of conversation")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    await renderApp("/channels/0", {
      ...seedBase(),
      conversations: [[channel0, { messages: [], cursor: null }]],
    });
    expectDataMt(byDataMt("message-list"), "message-list", { state: "empty" });
  });
});
