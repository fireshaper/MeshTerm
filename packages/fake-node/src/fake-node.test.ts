import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeFrame, encodeToRadio } from "@meshterm/protocol";
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

describe("FakeNode framing", () => {
  it("binds a free port when given port 0", () => {
    expect(node.port).toBeGreaterThan(0);
  });

  it("logs one message from a frame split across three writes", async () => {
    const frame = encodeFrame(
      encodeToRadio({ payloadVariant: { case: "wantConfigId", value: 7 } }),
    );
    await client.write(frame.subarray(0, 1));
    await client.write(frame.subarray(1, 3));
    await client.write(frame.subarray(3));
    await until(() => node.inbound.length > 0);
    expect(node.inbound).toHaveLength(1);
    expect(node.inbound[0]?.message.payloadVariant).toEqual({ case: "wantConfigId", value: 7 });
  });

  it("logs one message after garbage bytes and a valid frame", async () => {
    await client.write(new Uint8Array([0x00, 0xff, 0x94, 0x12, 0x94, 0xc3, 0xff, 0xff]));
    client.send({ payloadVariant: { case: "heartbeat", value: {} } });
    await until(() => node.inbound.length > 0);
    // Give any stray parse a moment to show up.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(node.inbound).toHaveLength(1);
    expect(node.inbound[0]?.message.payloadVariant.case).toBe("heartbeat");
  });

  it("clears the inbound log", async () => {
    client.send({ payloadVariant: { case: "heartbeat", value: {} } });
    await until(() => node.inbound.length === 1);
    node.clearInbound();
    expect(node.inbound).toHaveLength(0);
  });
});
