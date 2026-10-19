import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Portnums } from "@meshterm/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startControlServer, type InboundReport } from "./control-server.js";
import { FakeNode } from "./fake-node.js";
import { RawClient, until } from "./test-client.js";

let node: FakeNode;
let control: Server;
let client: RawClient;
let base: string;

beforeEach(async () => {
  node = new FakeNode();
  await node.start();
  control = startControlServer(node, 0);
  await new Promise((resolve) => control.once("listening", resolve));
  base = `http://127.0.0.1:${(control.address() as AddressInfo).port}`;
  client = await RawClient.open(node.port);
});

afterEach(async () => {
  client.close();
  await new Promise((resolve) => control.close(resolve));
  await node.stop();
});

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", body: JSON.stringify(body) });

describe("FakeNode control server", () => {
  it("injects a text to connected clients", async () => {
    const res = await post("/inject-text", {
      from: 0x0badcafe,
      target: { channel: 1 },
      text: "hi",
    });
    expect(res.status).toBe(200);
    const { packetId } = (await res.json()) as { packetId: number };
    await client.waitFor((r) => r.some((m) => m.payloadVariant.case === "packet"));
    const packet = client.received.find((m) => m.payloadVariant.case === "packet");
    expect(packet?.payloadVariant.case === "packet" && packet.payloadVariant.value).toMatchObject({
      id: packetId,
      from: 0x0badcafe,
      channel: 1,
    });
  });

  it("reports inbound traffic as a transmit audit, and clears it", async () => {
    client.send({ payloadVariant: { case: "wantConfigId", value: 1 } });
    client.send({
      payloadVariant: {
        case: "packet",
        value: {
          id: 5,
          to: 0x0badcafe,
          payloadVariant: {
            case: "decoded",
            value: {
              portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
              payload: new TextEncoder().encode("yo"),
            },
          },
        },
      },
    });
    await until(() => node.inbound.length === 2);
    const report = (await (await fetch(`${base}/inbound`)).json()) as InboundReport;
    expect(report.counts).toMatchObject({ handshake: 1, transmit: 1 });
    expect(report.transmits).toEqual([
      { to: 0x0badcafe, channel: 0, portnum: Portnums.PortNum.TEXT_MESSAGE_APP, text: "yo" },
    ]);

    await post("/clear-inbound", {});
    expect(node.inbound).toHaveLength(0);
  });

  it("answers unknown routes with 404 and bad JSON with 400", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/ack-mode`, { method: "POST", body: "{" })).status).toBe(400);
  });
});
