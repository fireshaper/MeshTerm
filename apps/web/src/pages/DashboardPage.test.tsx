import type { DashboardDTO } from "@meshterm/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioDashboard } from "../test/scenario.js";

const NOW = Date.now();

function dashboard(change: (d: DashboardDTO) => void = () => undefined): DashboardDTO {
  const d = scenarioDashboard("dashboard", NOW);
  change(d);
  return d;
}

const kpi = (variant: string) =>
  document.querySelector<HTMLElement>(`[data-mt="metric-card"][data-mt-variant="${variant}"]`);
const kpiValue = (variant: string) =>
  kpi(variant)?.querySelector('[data-mt="metric-card-value"]')?.textContent;
const kpiSecondary = (variant: string) =>
  kpi(variant)?.querySelector('[data-mt="metric-card-secondary"]')?.textContent;
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
      ? { window: "24h", bucketMs: 3_600_000, from: 0, to: 3_600_000, buckets: [] }
      : url.includes("/events")
        ? { events: [], nextBefore: null }
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

  it("shows six KPI cards with values, context and states", async () => {
    await renderApp("/dashboard", {
      dashboard: dashboard((d) => {
        const self = d.nodes.find((n) => n.isSelf);
        if (self?.device) {
          self.device.channelUtil = 26; // warn above 25
          self.device.airUtilTx = 10.5; // danger above 10
        }
        d.summary.messages24h = 58;
        d.summary.messagesIn24h = 50;
        d.summary.messagesOut24h = 8;
        d.summary.channelUtilSpark = [
          [NOW - 3600_000, 20],
          [NOW - 1800_000, 26],
        ];
      }),
    });
    expect(document.querySelectorAll('[data-mt="metric-card"]')).toHaveLength(6);
    // Active = heard < 15 min: MTB (now), RDG (2 min), GAR (10 min).
    expect(kpiValue("network-nodes")).toBe("3 / 7");
    expect(kpiValue("messages")).toBe("58");
    expect(kpiSecondary("messages")).toBe("50 received · 8 sent · 24 h");
    expectDataMt(kpi("channel-util"), "metric-card", { state: "warn" });
    expect(kpiValue("channel-util")).toBe("26%");
    expect(kpi("channel-util")?.querySelector('[data-mt="usage-bar"]')).toHaveAttribute(
      "aria-valuenow",
      "26",
    );
    expectDataMt(kpi("channel-util")?.querySelector('[data-mt="sparkline"]') ?? null, "sparkline");
    // No recorded history for air TX: no trend line rather than an invented one.
    expect(kpi("air-util-tx")?.querySelector('[data-mt="sparkline"]')).toBeNull();
    expectDataMt(kpi("air-util-tx"), "metric-card", { state: "danger" });
    expectDataMt(kpi("my-power"), "metric-card", { state: "ok" });
    expect(kpiValue("my-power")).toBe("87%");
    expect(kpiSecondary("my-power")).toMatch(/^4\.05 V · reported /);
    expectDataMt(kpi("connection"), "metric-card", { state: "ok" });
    expect(kpiValue("connection")).toBe("Connected");
    expect(kpiSecondary("connection")).toMatch(/^for 1h · last packet \d+ s ago$/);
  });

  it("says Unknown rather than zero when my node hasn't reported", async () => {
    await renderApp("/dashboard", {
      dashboard: dashboard((d) => {
        const self = d.nodes.find((n) => n.isSelf);
        if (self) self.device = null;
        d.summary.myBattery = null;
        d.summary.channelUtil = null;
        d.summary.airUtilTx = null;
      }),
    });
    for (const v of ["channel-util", "air-util-tx", "my-power"]) {
      expect(kpiValue(v)).toBe("Unknown");
      expectDataMt(kpi(v), "metric-card", { state: "unknown" });
    }
    expect(kpiSecondary("channel-util")).toBe("not reported yet");
  });

  it("pins my node and favorites, previews recent nodes and links to the full list", async () => {
    await renderApp("/dashboard", { dashboard: dashboard() });
    expect(previews("pinned")).toEqual(["MTB", "RDG", "HIL"]);
    expect(previews("recent")).toEqual(["GAR", "TRL"]);
    expect(
      within(panel("recent") as HTMLElement).getByRole("link", { name: /View all 7 nodes/ }),
    ).toHaveAttribute("href", "/nodes");
    const self = panel("pinned")?.querySelector<HTMLElement>('[data-mt="node-preview"]') ?? null;
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

  it("node previews: power, signal by hops, distance, and labels for old readings", async () => {
    await renderApp("/dashboard", { dashboard: dashboard() });
    const preview = (num: number) =>
      document.querySelector<HTMLElement>(`[data-mt="node-preview"][data-node-num="${num}"]`);
    const stat = (num: number, name: string) =>
      preview(num)?.querySelector(`[data-mt="preview-stat"][data-mt-variant="${name}"] dd`);
    // Ridge: external power, heard directly.
    expect(stat(195939070, "power")).toHaveTextContent("External");
    expect(stat(195939070, "signal")).toHaveTextContent("7.25 dB");
    expectDataMt(
      preview(195939070)?.querySelector('[data-mt="signal-bars"]') ?? null,
      "signal-bars",
      { state: "good" },
    );
    expect(stat(195939070, "distance")?.textContent).toMatch(/^\d+(\.\d)? km NE$/);
    // Garage: two hops, no route claimed.
    expect(stat(1584361601, "signal")).toHaveTextContent("via 2 hops");
    // Hilltop: its battery reading is 7 h old, and says so.
    expect(stat(573785173, "power")).toHaveTextContent("15%7h old");
    // My node shows uptime and altitude instead of signal and distance.
    expect(stat(2712847316, "uptime")).toHaveTextContent("3d 3h");
    expect(stat(2712847316, "distance")).toHaveTextContent("52 m");
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
    expect(previews("pinned")).toEqual(["MTB", "RDG", "GAR", "HIL"]);
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
      expect(previews("pinned")).toEqual(["MTB", "RDG", "HIL"]);
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
    expectDataMt(byDataMt("dashboard-empty"), "dashboard-empty");
    expect(byDataMt("dashboard-empty")).toHaveTextContent("config handshake");
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

  it("the traffic chart shows recorded buckets and remembers its window", async () => {
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
              { time: from, messagesIn: 2, messagesOut: 1, channelUtil: 11 },
              { time: from + hour, messagesIn: 0, messagesOut: 0, channelUtil: null },
              { time: from + 2 * hour, messagesIn: 4, messagesOut: 0, channelUtil: 13 },
            ],
          },
        ],
      ],
    });
    expect(
      screen.getByRole("img", {
        name: /6 received and 1 sent; my node's channel utilization averaged 12%/,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1 h" }));
    expect(fetchMock.mock.calls.map(([u]) => u)).toContain("/api/connections/1/traffic?window=1h");
    expect(localStorage.getItem("meshterm.trafficWindow")).toBe("1h");
  });
});
