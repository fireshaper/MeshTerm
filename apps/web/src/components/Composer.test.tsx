import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLiveStore, useLiveStore } from "../data/store.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { Composer } from "./Composer.js";

const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  resetLiveStore();
  useLiveStore.getState().setNodeState("connected");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const input = () => screen.getByRole("textbox", { name: "Message" });
const sendButton = () => screen.getByRole("button", { name: "Send" });
const counter = () => byDataMt("byte-counter");

describe("<Composer />", () => {
  it("counts UTF-8 bytes, not characters", async () => {
    render(<Composer connectionId={1} conversation={{ channel: 0 }} />);
    expectDataMt(byDataMt("composer"), "composer", { state: "disabled" });
    expect(counter()).toHaveTextContent("0/200");
    await userEvent.type(input(), "👋🏽");
    expect(counter()).toHaveTextContent("8/200"); // waving hand (4) + skin tone modifier (4)
    await userEvent.type(input(), "é");
    expect(counter()).toHaveTextContent("10/200");
  });

  it("disables sending when empty, blank, over the limit, or not connected", async () => {
    render(<Composer connectionId={1} conversation={{ channel: 0 }} />);
    expect(sendButton()).toBeDisabled();

    await userEvent.type(input(), "   ");
    expect(sendButton()).toBeDisabled();

    await userEvent.clear(input());
    await userEvent.click(input());
    await userEvent.paste("é".repeat(101)); // 202 bytes
    expect(sendButton()).toBeDisabled();
    expectDataMt(counter(), "byte-counter", { state: "over" });
    expect(input()).toHaveAttribute("aria-invalid", "true");

    await userEvent.clear(input());
    await userEvent.type(input(), "hi");
    expect(sendButton()).toBeEnabled();
    expectDataMt(byDataMt("composer"), "composer", { state: "ready" });

    act(() => {
      useLiveStore.getState().setNodeState("reconnecting");
    });
    expect(sendButton()).toBeDisabled();
    expect(byDataMt("composer-hint")).toHaveTextContent("reconnecting");
  });

  it("Enter sends once and clears the input; Shift+Enter adds a newline", async () => {
    respond(201, { message: {} });
    render(<Composer connectionId={1} conversation={{ peer: 195939070 }} />);
    await userEvent.type(input(), "line one{Shift>}{Enter}{/Shift}line two");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input()).toHaveValue("line one\nline two");

    await userEvent.type(input(), "{Enter}");
    await waitFor(() => {
      expect(input()).toHaveValue("");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/connections/1/messages");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ text: "line one\nline two", to: 195939070 });
  });

  it("sends a channel message with channel, not to", async () => {
    respond(201, { message: {} });
    render(<Composer connectionId={1} conversation={{ channel: 1 }} />);
    await userEvent.type(input(), "hello{Enter}");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      text: "hello",
      channel: 1,
    });
  });

  it.each([
    [409, "not_connected", "isn't connected"],
    [429, "rate_limited", "sending too fast"],
  ])("shows an error for %i and keeps the text", async (status, code, expected) => {
    respond(status, { error: code, message: "x" });
    render(<Composer connectionId={1} conversation={{ channel: 0 }} />);
    await userEvent.type(input(), "hello{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(expected);
    expect(input()).toHaveValue("hello");
    expectDataMt(byDataMt("composer"), "composer", { state: "error" });
  });
});
