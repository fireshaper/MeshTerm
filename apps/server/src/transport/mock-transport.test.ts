import { describe, expect, it } from "vitest";
import { describeTransportContract } from "./contract.js";
import { MockPeer } from "./mock-transport.js";

describeTransportContract("mock", () => {
  const peer = new MockPeer();
  const unreachable = new MockPeer();
  unreachable.reachable = false;
  return Promise.resolve({
    createTransport: () => peer.createTransport(),
    createUnreachableTransport: () => unreachable.createTransport(),
    sendFromRadio: (v) => {
      peer.sendFromRadio(v);
    },
    received: () => peer.received,
    closeFromPeer: () => {
      peer.close();
    },
    peerConnections: () => peer.connections,
    teardown: () => Promise.resolve(),
  });
});

describe("MockTransport", () => {
  it("emits error and stays open on bytes that don't decode", async () => {
    const peer = new MockPeer();
    const transport = peer.createTransport();
    const errors: Error[] = [];
    transport.on("error", (e) => errors.push(e));
    await transport.connect();
    peer.sendBytes(new Uint8Array([0xff, 0xff, 0xff]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(errors).toHaveLength(1);
    expect(transport.isOpen).toBe(true);
  });
});
