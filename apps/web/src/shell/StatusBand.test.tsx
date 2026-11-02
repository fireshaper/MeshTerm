import type { DeviceConfigDTO } from "@meshterm/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
import { useThemeStore } from "../theme/store.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { SCENARIO_MY_NODE, scenarioDashboard, scenarioNodes } from "../test/scenario.js";

const NOW = Date.now();

const config = (lora: Record<string, unknown>, primary = ""): DeviceConfigDTO =>
  ({
    connectionId: 1,
    version: "v",
    config: { lora },
    channels: [{ index: 0, role: "PRIMARY", settings: { name: primary } }],
  }) as unknown as DeviceConfigDTO;

const cell = (field: string) =>
  document.querySelector<HTMLElement>(`[data-mt="status-cell"][data-mt-variant="${field}"]`);
const value = (field: string) =>
  cell(field)?.querySelector('[data-mt="status-cell-value"]')?.textContent;

beforeEach(() => {
  // Anything not seeded (traffic, activity…) answers empty; the band never needs it.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 404 }))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StatusBand (CR-005 §6.1)", () => {
  it("shows the link, frequency, preset, region and my node's readings", async () => {
    const dashboard = scenarioDashboard("dashboard", NOW);
    await renderApp("/messages/channel/0", {
      myNodeNum: SCENARIO_MY_NODE,
      dashboard,
      queries: [[queryKeys.deviceConfig(1), config({ region: "US", modemPreset: "LONG_FAST" })]],
    });
    expectDataMt(byDataMt("status-band"), "status-band");
    expect(value("link")).toContain("TCP 192.0.2.1:4403");
    expect(value("freq")).toBe("906.875 MHz");
    expect(cell("freq")).toHaveAttribute("title", "Frequency slot 20");
    expect(value("preset")).toBe("LongFastSF11/BW250");
    expect(value("region")).toBe("US");
    const self = dashboard.nodes.find((n) => n.isSelf);
    expect(value("channel-util")).toBe(
      self?.device?.channelUtil == null ? "—" : `${Number(self.device.channelUtil.toFixed(1))}%`,
    );
    expect(value("last-packet")).not.toBe("—");
  });

  it("shows dashes until the config and dashboard arrive", async () => {
    await renderApp("/messages/channel/0");
    for (const field of ["freq", "preset", "region", "channel-util", "battery", "uptime"]) {
      expect(value(field), field).toBe("—");
    }
    expect(screen.getByRole("status", { name: "Node: Connected" })).toBeInTheDocument();
  });

  it("marks a busy channel and a low battery", async () => {
    const dashboard = scenarioDashboard("dashboard", NOW);
    const self = dashboard.nodes.find((n) => n.isSelf);
    if (!self?.device) throw new Error("scenario: my node has no device metrics");
    self.device.channelUtil = 60;
    self.device.batteryLevel = 15;
    await renderApp("/messages/channel/0", { myNodeNum: SCENARIO_MY_NODE, dashboard });
    expectDataMt(cell("channel-util"), "status-cell", {
      state: "danger",
      variant: "channel-util",
    });
    expectDataMt(cell("battery"), "status-cell", { state: "warn", variant: "battery" });
  });
});

describe("header controls (CR-005 §6.1)", () => {
  it("the station pill shows my node and opens its details", async () => {
    const user = userEvent.setup();
    await renderApp("/messages/channel/0", {
      myNodeNum: SCENARIO_MY_NODE,
      nodes: scenarioNodes("default", NOW),
    });
    const pill = screen.getByRole("button", { name: /^My node: .+\. Show details$/ });
    expectDataMt(pill, "station-pill");
    await user.click(pill);
    expect(useUiStore.getState().selectedNode).toBe(SCENARIO_MY_NODE);
  });

  it("the mode button flips light and dark and keeps the choice", async () => {
    const user = userEvent.setup();
    useThemeStore.setState({ modePref: "dark" });
    await renderApp("/messages/channel/0");
    const button = screen.getByRole("button", { name: "Switch to light mode" });
    expectDataMt(button, "mode-button", { state: "dark" });
    await user.click(button);
    expect(useThemeStore.getState().modePref).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  });
});
