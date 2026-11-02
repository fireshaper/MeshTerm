import type { DashboardDTO } from "@meshterm/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { heroNodes } from "../dashboard/overview.js";
import { scenarioDashboard } from "../test/scenario.js";

const NOW = Date.now();

function dashboard(change: (d: DashboardDTO) => void = () => undefined): DashboardDTO {
  const d = scenarioDashboard("dashboard", NOW);
  change(d);
  return d;
}

const gauge = (variant: string) =>
  document.querySelector<HTMLElement>(`[data-mt="gauge"][data-mt-variant="${variant}"]`);
const gaugeText = (variant: string) =>
  gauge(variant)?.querySelector('[data-mt="gauge-number"]')?.textContent;
const panel = (variant: string) =>
  document.querySelector<HTMLElement>(`[data-mt="panel"][data-mt-variant="${variant}"]`);
const previews = (variant: string) =>
  [
    ...(panel(variant)?.querySelectorAll('[data-mt="node-preview"] [data-mt="node-short-name"]') ??
      []),
  ].map((e) => e.textContent);

/** Answers the shell's own lookups (connections, nodes) with empty lists. */
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | null) {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const answer = handler(url, init);
    if (answer) return answer;
    const empty = url.includes("/traffic")
      ? {
          window: "24h",
          bucketMs: 3_600_000,
          from: 0,
          to: 3_600_000,
          buckets: [],
          ports: [],
          topNodes: [],
        }
      : url.includes("/events")
        ? { events: [], nextBefore: null }
        : url.includes("/topology")
          ? { myNodeNum: null, windowMs: 86_400_000, nodes: [], links: [] }
          : url.includes("/history")
            ? {
                window: "24h",
                device: [],
                environment: [],
                positions: [],
                heard: { bucketMs: 3_600_000, buckets: [] },
              }
            : url.includes("/messages")
              ? { messages: [], nextCursor: null }
              : [];
    return Promise.resolve(new Response(JSON.stringify(empty), { status: 200 }));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DashboardPage", () => {
  it("loads everything with one API call, showing skeletons meanwhile", async () => {
    let resolve: (r: Response) => void = () => undefined;
    const fetchMock = stubFetch((url) =>
      url.endsWith("/dashboard")
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : null,
    );
    await renderApp("/dashboard");
    expectDataMt(byDataMt("dashboard"), "dashboard", { state: "loading" });
    expect(byDataMt("skeleton")).not.toBeNull();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/dashboard"))).toBe(true);
    });
    resolve(new Response(JSON.stringify(dashboard()), { status: 200 }));
    await screen.findAllByRole("article");
    expectDataMt(byDataMt("dashboard"), "dashboard", { state: "ready" });
    // One dashboard request; nothing per node.
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.filter((u) => u.endsWith("/dashboard"))).toEqual(["/api/connections/1/dashboard"]);
    expect(urls.filter((u) => /\/nodes\/\d/.test(u))).toEqual([]);
  });

  it("shows my node's conditions as gauges with states", async () => {
    await renderApp("/dashboard", {
      dashboard: dashboard((d) => {
        const self = d.nodes.find((n) => n.isSelf);
        if (self?.device) {
          self.device.channelUtil = 26; // warn above 25
          self.device.airUtilTx = 10.5; // danger above 10
        }
      }),
    });
    expect(document.querySelectorAll('[data-mt="gauge"]')).toHaveLength(3);
    expectDataMt(gauge("channel-util"), "gauge", { state: "warn", variant: "channel-util" });
    expect(gaugeText("channel-util")).toBe("26");
    expectDataMt(gauge("air-util-tx"), "gauge", { state: "danger" });
    expect(gaugeText("air-util-tx")).toBe("10.5");
    expectDataMt(gauge("battery"), "gauge", { state: "ok" });
    expect(gaugeText("battery")).toBe("87");
    expect(gauge("battery")?.querySelector('[data-mt="gauge-sub"]')).toHaveTextContent("4.05 V");
    expect(screen.getByRole("img", { name: "Ch util: 26 %" })).toBeInTheDocument();
  });

  it("gauges show a dash rather than zero when my node hasn't reported", async () => {
    await renderApp("/dashboard", {
      dashboard: dashboard((d) => {
        const self = d.nodes.find((n) => n.isSelf);
        if (self) self.device = null;
        d.summary.myBattery = null;
        d.summary.channelUtil = null;
        d.summary.airUtilTx = null;
      }),
    });
    for (const v of ["channel-util", "air-util-tx", "battery"]) {
      expect(gaugeText(v)).toBe("—");
      expectDataMt(gauge(v), "gauge", { state: "unknown" });
      expect(gauge(v)?.querySelector('[data-mt="gauge-value"]')).toBeNull();
    }
  });

  it("the hero map shows recent nodes with a headline; a pin opens its details", async () => {
    const user = userEvent.setup();
    const d = dashboard();
    await renderApp("/dashboard", { dashboard: d });
    const expected = heroNodes(d.nodes, NOW, d.thresholds).length;
    // jsdom has no layout: give the map a size, then let it measure again.
    expect(byDataMt("overview-hero")).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: /nodes on the air$/ }),
    ).toBeInTheDocument();
    expect(byDataMt("overview-headline-detail")?.textContent).toMatch(/heard direct/);
    expect(screen.getByRole("link", { name: "Open full map" })).toHaveAttribute("href", "/map");
    const pins = await waitFor(() => {
      const found = document.querySelectorAll('[data-mt="map-pin"]');
      expect(found.length).toBe(expected);
      return found;
    });
    expectDataMt(document.querySelector('[data-mt="map-pin"][data-mt-variant="self"]'), "map-pin", {
      variant: "self",
    });
    await user.click(pins[pins.length - 1] as HTMLElement);
    expect(useUiStore.getState().selectedNode).not.toBeNull();
  });

  it("the roster: my node, favorites, then the most recently heard, with a link to all nodes", async () => {
    await renderApp("/dashboard", { dashboard: dashboard() });
    const roster = previews("roster");
    expect(roster.slice(0, 3)).toEqual(["MTB", "RDG", "HIL"]);
    expect(roster).toHaveLength(7);
    expect(
      within(panel("roster") as HTMLElement).getByRole("link", { name: /All nodes/ }),
    ).toHaveAttribute("href", "/nodes");
    const self = panel("roster")?.querySelector<HTMLElement>('[data-mt="node-preview"]') ?? null;
    expectDataMt(self, "node-preview", { variant: "self CLIENT", state: "online" });
  });

  it("lists what needs attention", async () => {
    await renderApp("/dashboard", { dashboard: dashboard() });
    const items = [...document.querySelectorAll('[data-mt="attention-item"]')];
    expect(items.map((i) => i.textContent)).toEqual([
      "Hilltop SolarBattery 15%",
      "Hilltop SolarNot heard for 7h",
    ]);
    expectDataMt(items[0] ?? null, "attention-item", { state: "warn", variant: "battery" });
  });

  it("roster cards: power, signal by hops, bearing and distance, and labels for old readings", async () => {
    const user = userEvent.setup();
    await renderApp("/dashboard", { dashboard: dashboard() });
    const preview = (num: number) =>
      document.querySelector<HTMLElement>(`[data-mt="node-preview"][data-node-num="${num}"]`);
    const stat = (num: number, name: string) =>
      preview(num)?.querySelector(`[data-mt="preview-stat"][data-mt-variant="${name}"] dd`);
    // Ridge: external power, heard directly, north-east of my node.
    expect(stat(195939070, "power")).toHaveTextContent("External");
    expect(stat(195939070, "signal")).toHaveTextContent("7.25 dB");
    expectDataMt(
      preview(195939070)?.querySelector('[data-mt="signal-bars"]') ?? null,
      "signal-bars",
      { state: "good" },
    );
    expect(preview(195939070)?.querySelector('[data-mt="bearing-point"]')).toHaveTextContent("NE");
    expect(
      preview(195939070)?.querySelector('[data-mt="node-preview-distance"]')?.textContent,
    ).toMatch(/^\d+(\.\d)? km$/);
    // Garage: two hops, no route claimed.
    expect(stat(1584361601, "signal")).toHaveTextContent("2 hops");
    // Hilltop: its battery reading is 7 h old, and says so.
    expect(stat(573785173, "power")).toHaveTextContent("15%7h old");
    // My node shows uptime instead of signal, and "You" instead of a bearing.
    expect(stat(2712847316, "uptime")).toHaveTextContent("3d 3h");
    expect(preview(2712847316)?.querySelector('[data-mt="self-badge"]')).toHaveTextContent("You");
    // A click anywhere on the card opens the details.
    await user.click(
      preview(195939070)?.querySelector('[data-mt="node-preview-stats"]') as HTMLElement,
    );
    expect(useUiStore.getState().selectedNode).toBe(195939070);
  });

  it("toggles a favorite at once and asks the server", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch((_url, init) =>
      init?.method === "PUT"
        ? Promise.resolve(new Response(JSON.stringify({ node: {} }), { status: 200 }))
        : null,
    );
    await renderApp("/dashboard", { dashboard: dashboard() });
    await user.click(screen.getByRole("button", { name: "Favorite Garage Station" }));
    expect(previews("roster").slice(0, 4)).toEqual(["MTB", "RDG", "GAR", "HIL"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/connections/1/nodes/1584361601/favorite",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ favorite: true }) }),
    );
  });

  it("flips a favorite back when the server refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubFetch((_url, init) =>
      init?.method === "PUT"
        ? Promise.resolve(
            new Response(JSON.stringify({ error: "not_found", message: "x" }), { status: 404 }),
          )
        : null,
    );
    await renderApp("/dashboard", { dashboard: dashboard() });
    await user.click(screen.getByRole("button", { name: "Unfavorite Ridge Repeater" }));
    await waitFor(() => {
      expect(previews("roster").slice(0, 3)).toEqual(["MTB", "RDG", "HIL"]);
    });
  });

  it("updates live from the cache without remounting cards", async () => {
    const { queryClient } = await renderApp("/dashboard", { dashboard: dashboard() });
    const ridge = () =>
      document.querySelector<HTMLElement>('[data-mt="node-preview"][data-node-num="195939070"]');
    const before = ridge();
    queryClient.setQueryData(
      queryKeys.dashboard(1),
      dashboard((d) => {
        const r = d.nodes.find((n) => n.shortName === "RDG");
        if (r) r.snr = -9;
      }),
    );
    await waitFor(() => {
      expectDataMt(ridge()?.querySelector('[data-mt="signal-bars"]') ?? null, "signal-bars", {
        state: "poor",
      });
    });
    expect(ridge()).toBe(before);
  });

  it("shows an empty state before the node DB has anything", async () => {
    await renderApp("/dashboard", { dashboard: dashboard((d) => (d.nodes = [])) });
    expect(panel("roster")).toHaveTextContent("config handshake");
    expect(byDataMt("overview-headline-title")).toHaveTextContent("Only your node so far");
  });

  it("Reconnect asks the server and confirms with a toast; too many explains why", async () => {
    const user = userEvent.setup();
    let status = 202;
    const fetchMock = stubFetch((url, init) =>
      init?.method === "POST" && url.endsWith("/reconnect")
        ? Promise.resolve(
            new Response(
              JSON.stringify(
                status === 202
                  ? { state: "reconnecting" }
                  : { error: "rate_limited", message: "x" },
              ),
              { status },
            ),
          )
        : null,
    );
    await renderApp("/dashboard", { dashboard: dashboard() });
    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/connections/1/reconnect",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText("Reconnecting to your node…")).toBeInTheDocument();
    status = 429;
    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(
      await screen.findByText("Too many reconnects; try again in a minute."),
    ).toBeInTheDocument();
  });

  it("messages over time with totals, packets by type in the mesh detail, and the window is remembered", async () => {
    const user = userEvent.setup();
    const hour = 3_600_000;
    const from = Math.floor(NOW / hour) * hour - 2 * hour;
    const fetchMock = stubFetch(() => null);
    await renderApp("/dashboard", {
      dashboard: dashboard(),
      queries: [
        [
          queryKeys.traffic(1, "24h"),
          {
            window: "24h",
            bucketMs: hour,
            from,
            to: from + 3 * hour,
            buckets: [
              {
                time: from,
                messagesIn: 2,
                messagesOut: 1,
                channelUtil: 11,
                packets: 10,
                packetsByPort: { POSITION_APP: 6, TEXT_MESSAGE_APP: 4 },
              },
              {
                time: from + hour,
                messagesIn: 0,
                messagesOut: 0,
                channelUtil: null,
                packets: 0,
                packetsByPort: {},
              },
              {
                time: from + 2 * hour,
                messagesIn: 4,
                messagesOut: 0,
                channelUtil: 13,
                packets: 5,
                packetsByPort: { TELEMETRY_APP: 5 },
              },
            ],
            ports: [
              { port: "POSITION_APP", packets: 6 },
              { port: "TELEMETRY_APP", packets: 5 },
              { port: "TEXT_MESSAGE_APP", packets: 4 },
            ],
            topNodes: [
              { num: 195939070, packets: 9 },
              { num: 1584361601, packets: 6 },
            ],
          },
        ],
      ],
    });
    // Messages as stacked areas with totals; packets by type in the mesh detail.
    expect(
      screen.getByRole("img", {
        name: /6 received and 1 sent; my node's channel utilization averaged 12%/,
      }),
    ).toBeInTheDocument();
    const totals = [...document.querySelectorAll('[data-mt="traffic-total"]')].map(
      (e) => e.textContent,
    );
    expect(totals.slice(0, 2)).toEqual(["Received6", "Sent1"]);
    expect(document.querySelectorAll('[data-mt="chart-area"]')).toHaveLength(2);
    expect(byDataMt("mesh-detail")).not.toHaveAttribute("open");
    expect(
      screen.getByRole("img", {
        name: /15 packets heard \(Position 6, Telemetry 5, Text 4\); my node's channel utilization averaged 12%/,
      }),
    ).toBeInTheDocument();
    const busiest = [...document.querySelectorAll('[data-mt="busiest-node"]')].map(
      (e) => e.textContent,
    );
    expect(busiest).toEqual(["Ridge Repeater9 packets", "Garage Station6 packets"]);
    await user.click(screen.getByRole("button", { name: "Ridge Repeater" }));
    expect(useUiStore.getState().selectedNode).toBe(195939070);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // Neither panel offers the Packets / Messages switch any more.
    expect(screen.queryByRole("button", { name: "Packets" })).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "1 h" })[0] as HTMLElement);
    expect(fetchMock.mock.calls.map(([u]) => u)).toContain("/api/connections/1/traffic?window=1h");
    expect(localStorage.getItem("meshterm.trafficWindow")).toBe("1h");
  });
});
