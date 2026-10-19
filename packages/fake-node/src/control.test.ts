import { fromBinary, type FromRadio, Mesh, Portnums } from "@meshterm/protocol";
import { BROADCAST_NUM } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeNode } from "./fake-node.js";
import { RawClient, until } from "./test-client.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const NOW_MS = 1_800_000_000_000;

let node: FakeNode;
let client: RawClient;

beforeEach(async () => {
  node = new FakeNode({ now: () => NOW_MS });
  await node.start();
  client = await RawClient.open(node.port);
});

afterEach(async () => {
  client.close();
  await node.stop();
});

function packets(received: FromRadio[]): Mesh.MeshPacket[] {
  return received.flatMap((m) =>
    m.payloadVariant.case === "packet" ? [m.payloadVariant.value] : [],
  );
}

function decoded(packet: Mesh.MeshPacket | undefined): Mesh.Data {
  if (packet?.payloadVariant.case !== "decoded") throw new Error("not a decoded packet");
  return packet.payloadVariant.value;
}

function routingReplies(received: FromRadio[]): { requestId: number; routing: Mesh.Routing }[] {
  return packets(received)
    .map(decoded)
    .filter((d) => d.portnum === Portnums.PortNum.ROUTING_APP)
    .map((d) => ({ requestId: d.requestId, routing: fromBinary(Mesh.RoutingSchema, d.payload) }));
}

function sendText(id: number, to: number): void {
  client.send({
    payloadVariant: {
      case: "packet",
      value: {
        id,
        to,
        wantAck: true,
        payloadVariant: {
          case: "decoded",
          value: {
            portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
            payload: new TextEncoder().encode("hi"),
          },
        },
      },
    },
  });
}

describe("injectText", () => {
  it("delivers a channel text with a unique id and RX signal values", async () => {
    const a = node.injectText(RIDGE, { channel: 1 }, "hello mesh", { rxSnr: 5.5, rxRssi: -90 });
    const b = node.injectText(RIDGE, { channel: 1 }, "again");
    await client.waitFor((r) => packets(r).length === 2);
    const [first] = packets(client.received);
    expect(a).not.toBe(b);
    expect(first).toMatchObject({
      from: RIDGE,
      to: BROADCAST_NUM,
      channel: 1,
      id: a,
      rxSnr: 5.5,
      rxRssi: -90,
      rxTime: NOW_MS / 1000,
    });
    expect(decoded(first).portnum).toBe(Portnums.PortNum.TEXT_MESSAGE_APP);
    expect(new TextDecoder().decode(decoded(first).payload)).toBe("hello mesh");
  });

  it("delivers a DM addressed to one node", async () => {
    node.injectText(RIDGE, { to: ME }, "psst", { hopsAway: 2 });
    await client.waitFor((r) => packets(r).length === 1);
    const [dm] = packets(client.received);
    expect(dm).toMatchObject({ from: RIDGE, to: ME, channel: 0, hopStart: 3, hopLimit: 1 });
  });
});

describe("injectNodeInfo", () => {
  it("delivers a NODEINFO_APP packet and adds the node to later handshakes", async () => {
    const num = 0x77777777;
    node.injectNodeInfo({
      num,
      user: { id: "!77777777", longName: "Newcomer", shortName: "NEW" },
      snr: 3,
      hopsAway: 1,
    });
    await client.waitFor((r) => packets(r).length === 1);
    const [packet] = packets(client.received);
    expect(packet).toMatchObject({ from: num, to: BROADCAST_NUM, rxSnr: 3, hopLimit: 2 });
    expect(decoded(packet).portnum).toBe(Portnums.PortNum.NODEINFO_APP);
    expect(fromBinary(Mesh.UserSchema, decoded(packet).payload).longName).toBe("Newcomer");

    client.send({ payloadVariant: { case: "wantConfigId", value: 5 } });
    await client.waitFor((r) => r.at(-1)?.payloadVariant.case === "configCompleteId");
    const newcomer = client.received.find(
      (m) => m.payloadVariant.case === "nodeInfo" && m.payloadVariant.value.num === num,
    );
    expect(
      newcomer?.payloadVariant.case === "nodeInfo" && newcomer.payloadVariant.value.lastHeard,
    ).toBe(NOW_MS / 1000);
  });
});

describe("setAckMode", () => {
  it("ack: answers a sent text with a routing ACK whose request id matches", async () => {
    node.setAckMode("ack");
    sendText(0x1234, RIDGE);
    await client.waitFor((r) => routingReplies(r).length === 1);
    const [reply] = routingReplies(client.received);
    expect(reply?.requestId).toBe(0x1234);
    expect(reply?.routing.variant).toEqual({ case: "errorReason", value: Mesh.Routing_Error.NONE });
    // The ACK for a DM comes from the recipient.
    expect(packets(client.received)[0]?.from).toBe(RIDGE);
  });

  it("nak: answers with a routing error", async () => {
    node.setAckMode("nak");
    sendText(0x2345, BROADCAST_NUM);
    await client.waitFor((r) => routingReplies(r).length === 1);
    const [reply] = routingReplies(client.received);
    expect(reply?.requestId).toBe(0x2345);
    expect(reply?.routing.variant).toEqual({
      case: "errorReason",
      value: Mesh.Routing_Error.MAX_RETRANSMIT,
    });
  });

  it("silent: sends only the queue status, no routing reply", async () => {
    node.setAckMode("silent");
    sendText(0x3456, RIDGE);
    await client.waitFor((r) => r.some((m) => m.payloadVariant.case === "queueStatus"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(routingReplies(client.received)).toHaveLength(0);
    const status = client.received.find((m) => m.payloadVariant.case === "queueStatus");
    expect(
      status?.payloadVariant.case === "queueStatus" && status.payloadVariant.value.meshPacketId,
    ).toBe(0x3456);
  });

  it("delays the answer when asked", async () => {
    node.setAckMode("ack", 100);
    sendText(0x4567, RIDGE);
    await client.waitFor((r) => r.some((m) => m.payloadVariant.case === "queueStatus"));
    expect(routingReplies(client.received)).toHaveLength(0);
    await client.waitFor((r) => routingReplies(r).length === 1);
  });
});

describe("reboot", () => {
  it("refuses connections while down and accepts again afterwards", async () => {
    const rebooted = node.reboot(500);
    await until(() => client.socket.destroyed);

    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(RawClient.open(node.port)).rejects.toThrow(/ECONNREFUSED/);

    await new Promise((resolve) => setTimeout(resolve, 600));
    await rebooted;
    const again = await RawClient.open(node.port);
    again.send({ payloadVariant: { case: "wantConfigId", value: 9 } });
    await again.waitFor((r) => r.at(-1)?.payloadVariant.case === "configCompleteId");
    const myInfo = again.received[0];
    // The default scenario starts at rebootCount 3.
    expect(
      myInfo?.payloadVariant.case === "myInfo" && myInfo.payloadVariant.value.rebootCount,
    ).toBe(4);
    again.close();
  });
});

describe("stop", () => {
  it("closes clients and refuses new connections", async () => {
    await node.stop();
    await until(() => client.socket.destroyed);
    await expect(RawClient.open(node.port)).rejects.toThrow(/ECONNREFUSED/);
  });
});
