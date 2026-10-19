import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioChannels } from "../test/scenario.js";
import { channelLabel } from "./ChannelTabs.js";

const tabs = () => [...document.querySelectorAll<HTMLElement>('[data-mt="channel-tab"]')];

describe("<ChannelTabs />", () => {
  it("renders one tab per enabled channel of the FakeNode scenario", async () => {
    await renderApp("/channels/0", { channels: scenarioChannels("default") });
    expect(tabs()).toHaveLength(2);
    expect(tabs().map((t) => t.textContent)).toEqual(["Primary", "Friends"]);
    expectDataMt(tabs()[0] ?? null, "channel-tab", { state: "active", variant: "primary" });
    expectDataMt(tabs()[1] ?? null, "channel-tab", { state: "inactive", variant: "secondary" });
  });

  it("skips disabled channels", async () => {
    const channels = [
      ...scenarioChannels("default"),
      { connectionId: 1, index: 2, name: "Off", role: "DISABLED" as const },
    ];
    await renderApp("/channels/0", { channels });
    expect(tabs()).toHaveLength(2);
  });

  it("clicking the second tab routes to /channels/1 and moves the active state", async () => {
    const { router } = await renderApp("/channels/0", { channels: scenarioChannels("default") });
    const second = tabs()[1];
    if (!second) throw new Error("no second tab");
    await userEvent.click(second);
    await act(() => router.load());
    expect(router.state.location.pathname).toBe("/channels/1");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Channel 1");
    expectDataMt(tabs()[0] ?? null, "channel-tab", { state: "inactive" });
    expectDataMt(tabs()[1] ?? null, "channel-tab", { state: "active" });
    expect(tabs()[1]).toHaveAttribute("aria-current", "page");
  });

  it("labels channels by name, then role", () => {
    expect(channelLabel({ connectionId: 1, index: 0, name: "", role: "PRIMARY" })).toBe("Primary");
    expect(channelLabel({ connectionId: 1, index: 3, name: "", role: "SECONDARY" })).toBe(
      "Channel 3",
    );
    expect(channelLabel({ connectionId: 1, index: 1, name: "Friends", role: "SECONDARY" })).toBe(
      "Friends",
    );
  });
});
