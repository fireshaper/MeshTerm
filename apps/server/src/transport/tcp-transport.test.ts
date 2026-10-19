import { createServer, Socket, type AddressInfo } from "node:net";
import { FakeNode } from "@meshterm/fake-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeTransportContract } from "./contract.js";
import { TcpTransport } from "./tcp-transport.js";

const TIMEOUTS = { connectTimeoutMs: 2_000, keepAliveMs: 15_000 };

/** A port with nothing listening on it. */
async function deadPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describeTransportContract("tcp against FakeNode", async () => {
  const node = new FakeNode();
  await node.start();
  const unusedPort = await deadPort();
  return {
    createTransport: () => new TcpTransport({ host: "127.0.0.1", port: node.port, ...TIMEOUTS }),
    createUnreachableTransport: () =>
      new TcpTransport({ host: "127.0.0.1", port: unusedPort, ...TIMEOUTS }),
    sendFromRadio: (v) => {
      node.sendFromRadio(v);
    },
    received: () => node.inbound.map((e) => e.message),
    closeFromPeer: () => {
      node.dropClients();
    },
    peerConnections: () => node.clientCount,
    teardown: () => node.stop(),
  };
});

describe("TcpTransport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets TCP keepalive and no-delay from config once connected", async () => {
    const keepAlive = vi.spyOn(Socket.prototype, "setKeepAlive");
    const node = new FakeNode();
    await node.start();
    const transport = new TcpTransport({
      host: "127.0.0.1",
      port: node.port,
      connectTimeoutMs: 1_000,
      keepAliveMs: 12_345,
    });
    await transport.connect();
    expect(keepAlive).toHaveBeenCalledWith(true, 12_345);
    await transport.disconnect();
    await node.stop();
  });

  it("rejects connect() after the connect timeout when nothing answers", async () => {
    // 10.255.255.1 is a non-routable address: the SYN goes unanswered (or the OS
    // reports it unreachable straight away; both must reject promptly).
    const transport = new TcpTransport({
      host: "10.255.255.1",
      port: 4403,
      connectTimeoutMs: 200,
      keepAliveMs: 15_000,
    });
    const started = Date.now();
    await expect(transport.connect()).rejects.toThrow(/timed out|EHOSTUNREACH|ENETUNREACH/);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(transport.isOpen).toBe(false);
  });

  it("disconnect() during connect() rejects the pending connect", async () => {
    const transport = new TcpTransport({
      host: "10.255.255.1",
      port: 4403,
      connectTimeoutMs: 5_000,
      keepAliveMs: 15_000,
    });
    const pending = transport.connect();
    await transport.disconnect();
    await expect(pending).rejects.toThrow();
  });
});
