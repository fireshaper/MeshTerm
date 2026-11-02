import {
  fixtures,
  type NodeDetailDTO,
  type NodeHistory,
  type SeriesDTO,
  type SignalDTO,
} from "@meshterm/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { openNodeDetails, useUiStore } from "../data/ui-store.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioChannels, scenarioDashboard, scenarioNodeDetail } from "../test/scenario.js";
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

const HOUR = 3600_000;
const T = [NOW - 3 * HOUR, NOW - 2 * HOUR, NOW - HOUR];

function deviceSeries(): SeriesDTO {
  return {
    kind: "device",
    from: NOW - 24 * HOUR,
    to: NOW,
    bucketMs: 5 * 60_000,
    t: T,
    count: [3, 3, 3],
    series: {
      battery_level: { avg: [null, null, null], min: [null, null, null], max: [null, null, null] },
      powered: { avg: [1, 1, 1], min: [1, 1, 1], max: [1, 1, 1] },
      voltage: { avg: [5.1, 5.09, 5.1], min: [5.08, 5.08, 5.09], max: [5.12, 5.1, 5.11] },
    },
  };
}

function signalSeries(): SignalDTO {
  return {
    kind: "signal",
    from: NOW - 24 * HOUR,
    to: NOW,
    bucketMs: 5 * 60_000,
    t: T,
    count: [4, 4, 4],
    series: {
      snr: { avg: [7, 7.5, 7.25], min: [6, 7, 7], max: [8, 8, 7.5] },
      rssi: { avg: [-80, -79, -81], min: [-82, -80, -83], max: [-78, -77, -80] },
      hops: { avg: [0, 0, 0], min: [0, 0, 0], max: [0, 0, 0] },
    },
    rate: { bucketMs: HOUR, t: T, packets: [4, 4, 4] },
  };
}

/** The Nodes page with the drawer's data cached, as if fetched. */
async function render(
  num: number,
  path = "/nodes",
  change: (d: NodeDetailDTO) => NodeDetailDTO = (d) => d,
) {
  return renderApp(path, {
    dashboard: scenarioDashboard("dashboard", NOW),
    channels: scenarioChannels(),
    queries: [
      [queryKeys.nodeDetail(1, num), change(scenarioNodeDetail(num, "dashboard", NOW))],
      [queryKeys.history(1, num, "24h"), history()],
      [queryKeys.series(1, num, "device", "24h"), deviceSeries()],
      [queryKeys.signal(1, num, "24h"), signalSeries()],
      [queryKeys.signal(1, num, "30d"), signalSeries()],
      [
        queryKeys.messagesFrom(1, num),
        [
          {
            ...fixtures.inboundMessage,
            fromNum: num,
            peer: num,
            text: "see you at the ridge",
            rxTime: NOW - 120_000,
          },
          {
            ...fixtures.inboundMessage,
            id: "00000000-0000-4000-8000-0000000000aa",
            fromNum: num,
            peer: null,
            channelIndex: 1,
            text: "anyone up the ridge?",
            rxTime: NOW - 600_000,
          },
        ],
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
    expect(byDataMt("node-drawer-short")).toHaveTextContent("RDG");
    expect(byDataMt("node-drawer-subtitle")).toHaveTextContent("!0badcafe · RAK WisBlock 4631");
    const pills = [...document.querySelectorAll('[data-mt="node-drawer-pill"]')].map(
      (p) => p.textContent,
    );
    expect(pills).toEqual(["Router", "Heard directly"]);
    expectDataMt(byDataMt("node-drawer-seen"), "node-drawer-seen", { state: "online" });
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
    // Recent messages from this node: DMs and channels (CR-005, `?from=`).
    expect(screen.getByText("see you at the ridge")).toBeInTheDocument();
    const where = [...document.querySelectorAll('[data-mt="detail-message-where"]')].map(
      (e) => e.textContent,
    );
    expect(where).toEqual(["DM", "CH 1 · Friends"]);
    // The stat grid and "… of you".
    const stat = (v: string) =>
      document.querySelector(`[data-mt="detail-stat"][data-mt-variant="${v}"] dd`);
    expect(stat("hops")).toHaveTextContent("Direct");
    expect(stat("snr")).toHaveTextContent("7.25 dB");
    expect(stat("battery")).toHaveTextContent("Powered");
    expect(stat("bearing")).toHaveTextContent("NE");
    expect(byDataMt("detail-where")?.textContent).toMatch(/^\d+(\.\d)? km NE of you$/);
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
    // External power: the battery chart shows a "Powered" band; voltage has values.
    expect(
      await within(dialog).findByRole("img", {
        name: "Voltage, 24 h: Voltage min 5.08 V max 5.12 V latest 5.10 V",
      }),
    ).toBeInTheDocument();
    // External power: a note says so (the tab is loaded by now).
    expect(
      dialog.querySelector('[data-mt="detail-note"][data-mt-variant="mains"]'),
    ).toHaveTextContent("external power");
    expectDataMt(
      dialog.querySelector('[data-mt="chart-group"][data-mt-variant="battery"]'),
      "chart-group",
      { state: "ready", variant: "battery" },
    );
    expect(within(dialog).getByRole("link", { name: "Export CSV" })).toHaveAttribute(
      "href",
      expect.stringMatching(
        /^\/api\/connections\/1\/nodes\/195939070\/telemetry\.csv\?from=\d+&to=\d+$/,
      ),
    );
    await user.click(
      within(dialog).getAllByRole("button", { name: "View as table" })[1] as HTMLElement,
    );
    expect(within(dialog).getByRole("table")).toHaveTextContent("5.10 V");
    within(dialog).getByRole("tab", { name: "Telemetry" }).focus();
    await user.keyboard("{ArrowRight}");
    expectDataMt(within(dialog).getByRole("tab", { name: "Signal" }), "node-drawer-tab", {
      state: "active",
      variant: "signal",
    });
    expect(
      await within(dialog).findByRole("img", {
        name: /^SNR \(heard directly\), 24 h: SNR min 6\.0 dB/,
      }),
    ).toBeInTheDocument();
    // Heard directly: the scale is explained, no multi-hop note.
    expect(
      dialog.querySelector('[data-mt="detail-note"][data-mt-variant="scale"]'),
    ).toHaveTextContent("−17.5 dB");
    expect(dialog.querySelector('[data-mt="detail-note"][data-mt-variant="multi-hop"]')).toBeNull();
    // The range is shared and remembered.
    await user.click(within(dialog).getByRole("button", { name: "30 d" }));
    expect(
      await within(dialog).findByText("Signal history is kept for 7 days."),
    ).toBeInTheDocument();
    expect(localStorage.getItem("meshterm.nodeRange")).toBe('{"preset":"30d"}');
    await user.click(within(dialog).getByRole("tab", { name: "Raw" }));
    const raw = document.querySelector('[data-mt="raw-json"][data-mt-variant="node"]');
    expect(raw?.textContent).toContain('"publicKey"');
    expect(raw?.querySelector('[data-mt="raw-key"]')).not.toBeNull();
  });

  it("Signal for a node heard through relays says why there's no signal history", async () => {
    const user = userEvent.setup();
    const { dialog } = await open(RIDGE, (d) => ({ ...d, hopsAway: 2 }));
    await user.click(within(dialog).getByRole("tab", { name: "Signal" }));
    expect(await screen.findByText(/My node hears this one through 2 hops/)).toHaveAttribute(
      "data-mt-variant",
      "multi-hop",
    );
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

describe("Request telemetry (CR-001 C4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks after a confirmation, then says when the answer came", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        // The shell's own reads (themes, config) aren't what this test is about.
        if (init?.method === "POST") {
          calls.push({ url, body: init.body ? JSON.parse(init.body as string) : null });
        }
        return Promise.resolve(
          new Response(JSON.stringify({ sentAt: NOW, timeoutMs: 60_000 }), { status: 202 }),
        );
      }),
    );
    const user = userEvent.setup();
    const { dialog, queryClient } = await open(RIDGE, (d) => ({ ...d, hopsAway: 1 }));
    await user.click(within(dialog).getByRole("button", { name: "Request telemetry" }));
    const confirm = await screen.findByRole("dialog", { name: /Request telemetry from/ });
    expect(confirm).toHaveTextContent("use airtime");
    await user.selectOptions(within(confirm).getByLabelText("What to ask for"), "environment");
    await user.click(within(confirm).getByRole("button", { name: "Send request" }));
    await waitFor(() => {
      expect(calls).toEqual([
        {
          url: `/api/connections/1/nodes/${RIDGE}/request-telemetry`,
          body: { kind: "environment" },
        },
      ]);
    });
    const { applyServerMessage } = await import("../data/apply.js");
    act(() => {
      applyServerMessage(queryClient, {
        type: "telemetry.request",
        connectionId: 1,
        nodeNum: RIDGE,
        kind: "environment",
        state: "received",
      });
    });
    expect(useUiStore.getState().toasts.map((t) => t.text)).toEqual(
      expect.arrayContaining([expect.stringMatching(/sent its environment telemetry/)]),
    );
  });

  it("isn't offered for our own node, far nodes, or viewers", async () => {
    let { dialog } = await open(RIDGE, (d) => ({ ...d, hopsAway: 4 }));
    expect(within(dialog).queryByRole("button", { name: "Request telemetry" })).toBeNull();
    ({ dialog } = await open(ME));
    expect(within(dialog).queryByRole("button", { name: "Request telemetry" })).toBeNull();
  });
});
