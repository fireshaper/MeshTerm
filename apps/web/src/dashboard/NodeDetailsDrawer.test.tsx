import { fixtures, type DashboardDTO, type NodeHistory } from "@meshterm/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../data/keys.js";
import { openNodeDetails, useUiStore } from "../data/ui-store.js";
import { expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioDashboard } from "../test/scenario.js";

const NOW = Date.now();
const RIDGE = 195939070;
const TRAIL = 439041101;
const BIKE = 1432778632;
const ME = 2712847316;

const history = (num: number): NodeHistory => ({
  window: "24h",
  device: [
    { time: NOW - 3 * 3600_000, batteryLevel: 60, voltage: 3.9, channelUtil: 10, airUtilTx: 1 },
    { time: NOW - 3600_000, batteryLevel: 55, voltage: 3.85, channelUtil: 12, airUtilTx: 1.2 },
  ],
  environment: [],
  positions:
    num === RIDGE ? [{ time: NOW - 3600_000, lat: 47.65, lon: -122.28, altitude: 312 }] : [],
  heard: {
    bucketMs: 3600_000,
    buckets: Array.from({ length: 24 }, (_, i) => ({
      time: NOW - (24 - i) * 3600_000,
      packets: i === 23 ? 4 : i === 20 ? 2 : 0,
    })),
  },
});

async function open(num: number, change: (d: DashboardDTO) => void = () => undefined) {
  const dashboard = scenarioDashboard("dashboard", NOW);
  change(dashboard);
  const result = await renderApp("/nodes", {
    dashboard,
    queries: [
      [queryKeys.history(1, num, "24h"), history(num)],
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
  act(() => {
    openNodeDetails(num);
  });
  const dialog = await screen.findByRole("dialog");
  return { ...result, dialog };
}

const field = (name: string) =>
  document.querySelector(`[data-mt="detail-field"][data-mt-variant="${name}"] dd`);

describe("<NodeDetailsDrawer />", () => {
  it("shows identity, status, signal, power, location, history and messages", async () => {
    const { dialog } = await open(RIDGE);
    expectDataMt(dialog, "node-drawer");
    expect(within(dialog).getByRole("heading", { name: "Ridge Repeater" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("RDG · Heard recently");
    expect(field("hops")).toHaveTextContent("Heard directly");
    expect(field("signal")).toHaveTextContent("SNR 7.25 dB");
    expect(field("id")).toHaveTextContent("!0badcafe");
    expect(field("hardware")).toHaveTextContent("RAK WisBlock 4631");
    expect(field("battery")).toHaveTextContent("External power · 5.10 V");
    expect(field("altitude")).toHaveTextContent("312 m");
    expect(field("distance")?.textContent).toMatch(/km NE$/);
    expect(
      within(dialog).getByRole("img", { name: /battery and channel utilization/ }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("see you at the ridge");
    expect(within(dialog).getByRole("link", { name: "Send a direct message" })).toHaveAttribute(
      "href",
      `/dm/${RIDGE}`,
    );
  });

  it("multi-hop and coarse nodes: route not known, approximate position", async () => {
    await open(TRAIL);
    expect(field("hops")).toHaveTextContent("1 hop (route not known)");
    expect(field("signal")).toHaveTextContent("Not available");
    expect(field("coordinates")).toHaveTextContent("(approximate, ±2.9 km)");
  });

  it("says Not available / Unknown instead of zeros for a node that never reported", async () => {
    const { dialog } = await open(BIKE);
    expect(field("battery")).toHaveTextContent("Unknown");
    expect(field("uptime")).toHaveTextContent("Not available");
    expect(field("utilization")).toHaveTextContent("Not available");
    expect(field("hops")).toHaveTextContent("Not available");
    expect(dialog).toHaveTextContent("No position shared");
    expect(field("last-heard")).toHaveTextContent("Never");
  });

  it("my node: no message action, no signal or hops", async () => {
    const { dialog } = await open(ME);
    expect(dialog).toHaveTextContent("My node");
    expect(within(dialog).queryByRole("link", { name: /direct message/ })).toBeNull();
    expect(field("signal")).toBeNull();
    expect(field("hops")).toBeNull();
  });

  it("labels a stale battery reading with its age", async () => {
    await open(573785173); // Hilltop, heard 7 h ago
    expect(field("battery")).toHaveTextContent("15%");
    expect(field("battery")).toHaveTextContent("reported 7h old");
  });

  it("closes with Escape and with the close button", async () => {
    const user = userEvent.setup();
    await open(RIDGE);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(useUiStore.getState().selectedNode).toBeNull();

    act(() => {
      openNodeDetails(RIDGE);
    });
    await user.click(await screen.findByRole("button", { name: "Close details" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("table rows open the drawer", async () => {
    const user = userEvent.setup();
    await renderApp("/nodes", { dashboard: scenarioDashboard("dashboard", NOW) });
    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(
      document.querySelector<HTMLElement>(
        `[data-mt="node-row"][data-node-num="${TRAIL}"] [data-mt="node-role"]`,
      ) ?? document.body,
    );
    expect(useUiStore.getState().selectedNode).toBe(TRAIL);
  });
});
