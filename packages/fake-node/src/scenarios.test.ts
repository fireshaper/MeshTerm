import type { AddressInfo } from "node:net";
import { fromBinary, Portnums, Telemetry, type FromRadio } from "@meshterm/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { startControlServer } from "./control-server.js";
import { FakeNode } from "./fake-node.js";
import { largeScenario, loadScenario } from "./scenario.js";
import { RawClient } from "./test-client.js";

let node: FakeNode | undefined;
let client: RawClient | undefined;

afterEach(async () => {
  client?.close();
  await node?.stop();
});

const isTelemetry = (m: FromRadio) =>
  m.payloadVariant.case === "packet" &&
  m.payloadVariant.value.payloadVariant.case === "decoded" &&
  m.payloadVariant.value.payloadVariant.value.portnum === Portnums.PortNum.TELEMETRY_APP;

const nodeInfos = (frames: FromRadio[]) =>
  new Map(
    frames.flatMap((m) =>
      m.payloadVariant.case === "nodeInfo"
        ? [[m.payloadVariant.value.num, m.payloadVariant.value]]
        : [],
    ),
  );

async function handshake(scenario: string): Promise<FromRadio[]> {
  node = new FakeNode({ scenario, now: () => 1_800_000_000_000 });
  await node.start();
  client = await RawClient.open(node.port);
  client.send({ payloadVariant: { case: "wantConfigId", value: 7 } });
  await client.waitFor((r) => r.some((m) => m.payloadVariant.case === "configCompleteId"));
  return client.received;
}

describe("dashboard scenario", () => {
  it("covers every dashboard fixture on the wire", async () => {
    const frames = await handshake("dashboard");
    await client?.waitFor((r) => r.some(isTelemetry));
    const infos = nodeInfos(client?.received ?? frames);
    expect(infos.size).toBe(7);

    expect(infos.get(0x0badcafe)?.deviceMetrics?.batteryLevel).toBe(101); // powered
    expect(infos.get(0x0badcafe)?.isFavorite).toBe(true);
    expect(infos.get(0x1a2b3c4d)?.position?.precisionBits).toBe(13); // reduced precision
    expect(infos.get(0x5e6f7081)?.hopsAway).toBe(2); // multi-hop
    expect(infos.get(0x33445566)?.position).toBeUndefined(); // no position
    expect(infos.get(0x33445566)?.lastHeard).toBe(1_800_000_000 - 259_200); // offline (3 days)
    expect(infos.get(0x22334455)?.lastHeard).toBe(1_800_000_000 - 25_200); // stale (7 h)
    expect(infos.get(0x55667788)?.lastHeard).toBe(0); // never heard

    // The environment sensor broadcasts its readings right after the handshake.
    const env = (client?.received ?? []).find(isTelemetry);
    const packet = env?.payloadVariant.case === "packet" ? env.payloadVariant.value : null;
    const data = packet?.payloadVariant.case === "decoded" ? packet.payloadVariant.value : null;
    expect(packet?.from).toBe(0x5e6f7081);
    const telemetry = fromBinary(Telemetry.TelemetrySchema, data?.payload ?? new Uint8Array());
    expect(telemetry.variant.case).toBe("environmentMetrics");
  });

  it("the default scenario still ends its handshake with config_complete_id", async () => {
    const frames = await handshake("default");
    expect(frames.at(-1)?.payloadVariant.case).toBe("configCompleteId");
    expect(nodeInfos(frames).size).toBe(4);
  });
});

describe("large scenario", () => {
  it("generates 300 nodes deterministically", () => {
    const a = largeScenario();
    const b = loadScenario("large");
    expect(a.nodes).toHaveLength(300);
    expect(a.nodes.map((n) => n.info.num)).toEqual(b.nodes.map((n) => n.info.num));
    expect(a.nodes.map((n) => n.info.user?.longName)).toEqual(
      b.nodes.map((n) => n.info.user?.longName),
    );
    const withPosition = a.nodes.filter((n) => n.info.position).length;
    expect(withPosition).toBeGreaterThan(200);
    expect(withPosition).toBeLessThan(300);
    expect(a.nodes[0]?.info.num).toBe(a.myInfo.myNodeNum);
  });

  it("sends all 300 in a handshake", async () => {
    const frames = await handshake("large");
    expect(nodeInfos(frames).size).toBe(300);
  });
});

describe("control API: telemetry and position", () => {
  it("injects device telemetry and positions", async () => {
    await handshake("dashboard");
    if (!node || !client) throw new Error("not started");
    const control = startControlServer(node, 0);
    await new Promise((resolve) => control.once("listening", resolve));
    const base = `http://127.0.0.1:${(control.address() as AddressInfo).port}`;
    try {
      const before = client.received.length;
      const t = await fetch(`${base}/inject-telemetry`, {
        method: "POST",
        body: JSON.stringify({ from: 0x0badcafe, device: { batteryLevel: 42 } }),
      });
      expect(t.status).toBe(200);
      const p = await fetch(`${base}/inject-position`, {
        method: "POST",
        body: JSON.stringify({ from: 0x0badcafe, lat: 47.61, lon: -122.33, precisionBits: 15 }),
      });
      expect(p.status).toBe(200);
      await client.waitFor((r) => r.length >= before + 2);
      const ports = client.received
        .slice(before)
        .map((m) =>
          m.payloadVariant.case === "packet" &&
          m.payloadVariant.value.payloadVariant.case === "decoded"
            ? m.payloadVariant.value.payloadVariant.value.portnum
            : null,
        );
      expect(ports).toEqual([Portnums.PortNum.TELEMETRY_APP, Portnums.PortNum.POSITION_APP]);

      const bad = await fetch(`${base}/inject-telemetry`, {
        method: "POST",
        body: JSON.stringify({ from: 1 }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await new Promise((resolve) => control.close(resolve));
    }
  });
});
