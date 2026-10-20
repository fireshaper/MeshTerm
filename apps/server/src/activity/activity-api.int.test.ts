import { auditInbound, FakeNode, until } from "@meshterm/fake-node";
import type { ActivityPage, NodeHistory, TopologyDTO, TrafficDTO } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";

const RIDGE = 0x0badcafe;
const GARAGE = 1584361601;

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp({ node: new FakeNode({ scenario: "dashboard" }) });
});

afterEach(async () => {
  await t.close();
});

/** Polls an async condition (`until` only takes synchronous ones). */
async function poll(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const get = async <T>(url: string): Promise<T> => {
  const res = await t.app.inject({ method: "GET", url });
  expect(res.statusCode, url).toBe(200);
  return res.json<T>();
};

describe("activity API", () => {
  it("feeds received messages to the activity log and the traffic series", async () => {
    t.node.injectText(RIDGE, { channel: 0 }, "hello feed");
    await poll(
      async () => (await get<ActivityPage>("/api/connections/1/events")).events.length > 0,
    );
    const { events } = await get<ActivityPage>("/api/connections/1/events");
    expect(events[0]).toMatchObject({
      kind: "message.in",
      nodeNum: RIDGE,
      detail: "hello feed",
      value: 0,
    });

    const traffic = await get<TrafficDTO>("/api/connections/1/traffic?window=1h");
    expect(traffic.window).toBe("1h");
    expect(traffic.buckets).toHaveLength(12);
    expect(traffic.buckets.reduce((n, b) => n + b.messagesIn, 0)).toBe(1);
    // My node's NodeInfo device metrics were stored at handshake: one utilization point.
    expect(traffic.buckets.filter((b) => b.channelUtil !== null).map((b) => b.channelUtil)).toEqual(
      [12.5],
    );
    for (const w of ["6h", "24h", "7d"]) {
      const res = await get<TrafficDTO>(`/api/connections/1/traffic?window=${w}`);
      expect(res.buckets.length).toBe({ "6h": 24, "24h": 24, "7d": 28 }[w]);
    }
    expect((await t.app.inject({ url: "/api/connections/1/traffic?window=2y" })).statusCode).toBe(
      400,
    );
  });

  it("returns a node's stored telemetry, environment and positions", async () => {
    t.node.injectTelemetry(GARAGE, {
      variant: { case: "deviceMetrics", value: { batteryLevel: 70, voltage: 3.9 } },
    });
    await poll(
      async () =>
        (await get<NodeHistory>(`/api/connections/1/nodes/${GARAGE}/history`)).device.length >= 2,
    );
    const history = await get<NodeHistory>(`/api/connections/1/nodes/${GARAGE}/history`);
    expect(history.window).toBe("24h");
    expect(history.device.at(-1)).toMatchObject({ batteryLevel: 70, voltage: 3.9 });
    expect(history.environment.at(-1)).toMatchObject({ temperature: 22.4 });
    expect(history.positions).toHaveLength(1);
    const times = history.device.map((d) => d.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const missing = await t.app.inject({ url: "/api/connections/1/nodes/12345/history" });
    expect(missing.statusCode).toBe(404);
  });

  it("reconnects on request, transmitting nothing but the handshake, and logs it", async () => {
    t.node.clearInbound();
    const res = await t.app.inject({ method: "POST", url: "/api/connections/1/reconnect" });
    expect(res.statusCode).toBe(202);
    const conn = t.app.meshterm.connections.get(1);
    await until(() => conn?.state === "connected", 5_000);
    const audit = auditInbound(t.node.inbound);
    expect(audit.counts.handshake).toBe(1);
    expect(audit.counts.transmit).toBe(0);
    expect(audit.counts.other).toBe(0);
    await poll(async () =>
      (await get<ActivityPage>("/api/connections/1/events")).events.some(
        (e) => e.kind === "connection.restored",
      ),
    );
    const kinds = (await get<ActivityPage>("/api/connections/1/events")).events.map((e) => e.kind);
    expect(kinds.slice(0, 2)).toEqual(["connection.restored", "connection.lost"]);
  });

  it("rate-limits reconnects and 404s unknown connections", async () => {
    const post = () => t.app.inject({ method: "POST", url: "/api/connections/1/reconnect" });
    for (let i = 0; i < 6; i++) expect((await post()).statusCode).toBe(202);
    expect((await post()).statusCode).toBe(429);
    for (const url of [
      "/api/connections/9/events",
      "/api/connections/9/traffic",
      "/api/connections/9/nodes/1/history",
    ]) {
      expect((await t.app.inject({ url })).statusCode, url).toBe(404);
    }
  });

  it("decodes NeighborInfo into reported links and counts packets by port", async () => {
    const TRAIL = 439041101;
    t.node.injectNeighborInfo(RIDGE, [
      { nodeId: TRAIL, snr: -2.25 },
      { nodeId: GARAGE, snr: 4.5 },
    ]);
    t.node.injectText(GARAGE, { channel: 0 }, "count me");
    await poll(async () =>
      (await get<TopologyDTO>("/api/connections/1/topology")).links.some(
        (l) => l.kind === "reported",
      ),
    );
    const topology = await get<TopologyDTO>("/api/connections/1/topology");
    expect(topology.windowMs).toBe(24 * 3600_000);
    expect(
      topology.links
        .filter((l) => l.kind === "reported")
        .map((l) => [l.from, l.to, l.snr])
        .sort(),
    ).toEqual(
      [
        [RIDGE, TRAIL, -2.25],
        [RIDGE, GARAGE, 4.5],
      ].sort(),
    );
    // Heard with 0 hops: Ridge and Hilltop (scenario), and now Garage, whose injected
    // text arrived directly. Kayak (3 days ago) is outside the window.
    expect(
      topology.links
        .filter((l) => l.kind === "direct")
        .map((l) => l.to)
        .sort(),
    ).toEqual([RIDGE, 573785173, GARAGE].sort());
    expect(topology.nodes.map((n) => n.num)).not.toContain(860116326);

    await poll(async () =>
      (await get<TrafficDTO>("/api/connections/1/traffic?window=1h")).ports.some(
        (p) => p.port === "TEXT_MESSAGE_APP",
      ),
    );
    const traffic = await get<TrafficDTO>("/api/connections/1/traffic?window=1h");
    const ports = Object.fromEntries(traffic.ports.map((p) => [p.port, p.packets]));
    expect(ports.NEIGHBORINFO_APP).toBe(1);
    expect(ports.TEXT_MESSAGE_APP).toBe(1);
    expect(traffic.topNodes.map((n) => n.num)).toContain(RIDGE);
  });
});
