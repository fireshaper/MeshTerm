import { fixtures, type NodeDetailDTO, type NodeHistory } from "@meshterm/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { queryKeys } from "../data/keys.js";
import { openNodeDetails, useUiStore } from "../data/ui-store.js";
import { expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioDashboard, scenarioNodeDetail } from "../test/scenario.js";
import { DRAWER_WIDTH_KEY } from "./width.js";

const NOW = Date.now();
const RIDGE = 195939070;
const TRAIL = 439041101;
const BIKE = 1432778632;
const HILL = 573785173;
const ME = 2712847316;

const history = (): NodeHistory => ({
  window: "24h",
  device: [
    { time: NOW - 3 * 3600_000, batteryLevel: 60, voltage: 3.9, channelUtil: 10, airUtilTx: 1 },
    { time: NOW - 3600_000, batteryLevel: 55, voltage: 3.85, channelUtil: 12, airUtilTx: 1.2 },
  ],
  environment: [],
  positions: [],
  heard: {
    bucketMs: 3600_000,
    buckets: Array.from({ length: 24 }, (_, i) => ({
      time: NOW - (24 - i) * 3600_000,
      packets: i === 23 ? 4 : 0,
    })),
  },
});

/** The Nodes page with the drawer's data cached, as if fetched. */
async function render(
  num: number,
  path = "/nodes",
  change: (d: NodeDetailDTO) => NodeDetailDTO = (d) => d,
) {
  return renderApp(path, {
    dashboard: scenarioDashboard("dashboard", NOW),
    queries: [
      [queryKeys.nodeDetail(1, num), change(scenarioNodeDetail(num, "dashboard", NOW))],
      [queryKeys.history(1, num, "24h"), history()],
      [
        queryKeys.messages(1, { peer: num }),
        {
          messages: [
            {
              ...fixtures.inboundMessage,
              fromNum: num,
              peer: num,
              text: "see you at the ridge",
              rxTime: NOW - 120_000,
            },
          ],
          cursor: null,
        },
      ],
    ],
  });
}

async function open(num: number, change?: (d: NodeDetailDTO) => NodeDetailDTO) {
  const result = await render(num, "/nodes", change);
  act(() => {
    openNodeDetails(num);
  });
  const dialog = await screen.findByRole("dialog");
  return { ...result, dialog };
}

const field = (name: string) =>
  document.querySelector(`[data-mt="detail-field"][data-mt-variant="${name}"] dd`);

afterEach(() => {
  localStorage.clear();
});

describe("<NodeDrawer />", () => {
  it("opens over the current view and puts the node in the URL", async () => {
    const { dialog, router } = await open(RIDGE);
    expectDataMt(dialog, "node-drawer");
    expect(router.state.location.pathname).toBe("/nodes");
    expect(router.state.location.search).toEqual({ node: "!0badcafe" });
    expect(within(dialog).getByRole("heading", { name: /Ridge Repeater/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Router · RAK WisBlock 4631");
    expect(dialog).toHaveTextContent("heard directly");
    expect(document.querySelector("[data-mt=node-list]")).toBeInTheDocument();
  });

  it("Overview: identity with key fingerprint, status, power, radio, position and 24 h", async () => {
    await open(RIDGE);
    expect(field("id")).toHaveTextContent("!0badcafe");
    expect(field("num")).toHaveTextContent("195939070 (0x0badcafe)");
    expect(field("public-key")).toHaveTextContent("0b30557a9fc4e90e");
    expect(field("pki")).toHaveTextContent("Yes");
    expect(field("hops")).toHaveTextContent("Heard directly");
    expect(field("signal")).toHaveTextContent("SNR 7.25 dB");
    expect(field("battery")).toHaveTextContent("Powered");
    expect(field("voltage")).toHaveTextContent("5.10 V");
    expect(field("distance")?.textContent).toMatch(/km NE$/);
    expect(field("packets")).toHaveTextContent("12");
    expect(screen.getAllByRole("link", { name: "Show on map" })[0]).toHaveAttribute(
      "href",
      "/map?focus=%210badcafe",
    );
    expect(screen.getByText("see you at the ridge")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Message" })).toHaveAttribute(
      "href",
      "/messages/dm/!0badcafe",
    );
  });

  it("environment sensors show every metric they report", async () => {
    await open(HILL, (d) => ({
      ...d,
      latestTelemetry: {
        ...d.latestTelemetry,
        environment: {
          time: NOW - 60_000,
          metrics: { temperature: 21.53, lux: 312, gas_resistance: 88.4 },
        },
        power: { time: NOW - 60_000, metrics: { ch1_voltage: 12.61, ch1_current: 250 } },
      },
    }));
    expect(field("temperature")).toHaveTextContent("21.5 °C");
    expect(field("lux")).toHaveTextContent("312 lx");
    expect(field("gas_resistance")).toHaveTextContent("88.4 MΩ");
    expect(field("ch1_voltage")).toHaveTextContent("12.61 V");
    expect(field("ch1_current")).toHaveTextContent("250 mA");
  });

  it("says Not available instead of zeros for a node that never reported", async () => {
    const { dialog } = await open(BIKE);
    expect(field("battery")).toHaveTextContent("Unknown");
    expect(field("uptime")).toHaveTextContent("Not available");
    expect(field("public-key")).toHaveTextContent("None shared");
    expect(field("last-heard")).toHaveTextContent("Never");
    expect(dialog).toHaveTextContent("No position shared");
  });

  it("my node: firmware, no Message action, no signal or hops", async () => {
    const { dialog } = await open(ME);
    expect(dialog).toHaveTextContent("My node");
    expect(field("firmware")?.textContent).toMatch(/^\d+\.\d+/);
    expect(within(dialog).queryByRole("link", { name: "Message" })).toBeNull();
    expect(field("signal")).toBeNull();
    expect(field("hops")).toBeNull();
  });

  it("multi-hop and coarse nodes: route not known, approximate position", async () => {
    await open(TRAIL);
    expect(field("hops")).toHaveTextContent("1 hop (route not known)");
    expect(field("signal")).toHaveTextContent("Not available");
    expect(field("precision")).toHaveTextContent("Approximate, ±2.9 km");
  });

  it("tabs: Telemetry loads its chart, Raw shows stored JSON; arrow keys move", async () => {
    const user = userEvent.setup();
    const { dialog } = await open(RIDGE);
    const tabs = within(dialog).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Overview", "Telemetry", "Signal", "Raw"]);
    await user.click(within(dialog).getByRole("tab", { name: "Telemetry" }));
    expect(
      await within(dialog).findByRole("img", { name: /battery and channel utilization/ }),
    ).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expectDataMt(within(dialog).getByRole("tab", { name: "Signal" }), "node-drawer-tab", {
      state: "active",
      variant: "signal",
    });
    expect(
      await within(dialog).findByText("Signal history is kept for 7 days."),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("tab", { name: "Raw" }));
    const raw = document.querySelector('[data-mt="raw-json"][data-mt-variant="node"]');
    expect(raw?.textContent).toContain('"publicKey"');
  });

  it("Escape and ✕ close it and drop ?node= from the URL", async () => {
    const user = userEvent.setup();
    const { router } = await open(RIDGE);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(router.state.location.search).toEqual({});
    expect(useUiStore.getState().selectedNode).toBeNull();

    act(() => {
      openNodeDetails(RIDGE);
    });
    await user.click(await screen.findByRole("button", { name: "Close details" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(router.state.location.pathname).toBe("/nodes");
  });

  it("Back closes it (opening pushed a history entry)", async () => {
    const { router } = await open(RIDGE);
    act(() => {
      router.history.back();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(router.state.location.pathname).toBe("/nodes");
  });

  it("?node= deep link opens it on any route; closing keeps the route", async () => {
    const user = userEvent.setup();
    const { router } = await render(TRAIL, "/nodes?node=!1a2b3c4d");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Trail Walker");
    await user.click(within(dialog).getByRole("button", { name: "Close details" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(router.state.location.pathname).toBe("/nodes");
    expect(router.state.location.search).toEqual({});
  });

  it("an unknown node says so", async () => {
    await renderApp("/nodes?node=!12345678", {
      dashboard: scenarioDashboard("dashboard", NOW),
      queries: [],
    });
    expect(await screen.findByRole("heading", { name: "Unknown node", hidden: true })).toBeTruthy();
  });

  it("the width can be changed with the keyboard and is remembered", async () => {
    const user = userEvent.setup();
    const { dialog } = await open(RIDGE);
    const handle = within(dialog).getByRole("separator", { name: "Resize details" });
    expect(handle).toHaveAttribute("aria-valuenow", "480");
    handle.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(handle).toHaveAttribute("aria-valuenow", "512");
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe("512");
    expect(dialog.style.getPropertyValue("--mt-node-drawer-width")).toBe("512px");
  });

  it("table rows open the drawer", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp("/nodes", {
      dashboard: scenarioDashboard("dashboard", NOW),
    });
    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(
      document.querySelector<HTMLElement>(
        `[data-mt="node-row"][data-node-num="${TRAIL}"] [data-mt="node-role"]`,
      ) ?? document.body,
    );
    expect(useUiStore.getState().selectedNode).toBe(TRAIL);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ node: "!1a2b3c4d" });
    });
  });
});
