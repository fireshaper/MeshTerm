import { Portnums } from "@meshterm/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditInbound } from "./audit.js";
import { FakeNode } from "./fake-node.js";
import { RawClient, until } from "./test-client.js";

let node: FakeNode;
let client: RawClient;

beforeEach(async () => {
  node = new FakeNode();
  await node.start();
  client = await RawClient.open(node.port);
});

afterEach(async () => {
  client.close();
  await node.stop();
});

describe("transmit audit", () => {
  it("reports zero transmits for a handshake and a heartbeat", async () => {
    client.send({ payloadVariant: { case: "wantConfigId", value: 1 } });
    client.send({ payloadVariant: { case: "heartbeat", value: {} } });
    await until(() => node.inbound.length === 2);
    const audit = auditInbound(node.inbound);
    expect(audit.counts).toEqual({ handshake: 1, heartbeat: 1, transmit: 0, other: 0 });
    expect(audit.transmits).toEqual([]);
  });

  it("reports one transmit after a text packet", async () => {
    client.send({ payloadVariant: { case: "wantConfigId", value: 1 } });
    client.send({ payloadVariant: { case: "heartbeat", value: {} } });
    client.send({
      payloadVariant: {
        case: "packet",
        value: {
          id: 99,
          to: 0xffff_ffff,
          payloadVariant: {
            case: "decoded",
            value: { portnum: Portnums.PortNum.TEXT_MESSAGE_APP, payload: new Uint8Array([104]) },
          },
        },
      },
    });
    await until(() => node.inbound.length === 3);
    const audit = auditInbound(node.inbound);
    expect(audit.counts.transmit).toBe(1);
    expect(audit.transmits[0]?.message.payloadVariant.case).toBe("packet");
  });
});
