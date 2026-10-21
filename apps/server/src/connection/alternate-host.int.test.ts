// A node that moved (new static IP, CR-002 §7.1): attempts alternate between the old
// address and the new one; the one that answers becomes the connection's address.
import { createServer } from "node:net";
import { FakeNode, until } from "@meshterm/fake-node";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import { TcpTransport } from "../transport/tcp-transport.js";
import { NodeConnection } from "./node-connection.js";
import { TEST_CONNECTION } from "./test-helpers.js";

const NEW_HOST = "192.0.2.77";

let node: FakeNode;
let conn: NodeConnection;
afterEach(async () => {
  await conn.stop();
  await node.stop();
});

/** A port nothing listens on: connections to it are refused at once. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return typeof address === "object" && address ? address.port : 1;
}

describe("NodeConnection.tryAlternateHost", () => {
  it("tries the old address, then the new one, and keeps the one that answered", async () => {
    node = new FakeNode();
    await node.start();
    const dead = await closedPort();
    const clock = new FakeClock();
    const tried: string[] = [];
    conn = new NodeConnection({
      connection: TEST_CONNECTION,
      // The "new address" is the FakeNode; the old one refuses.
      createTransport: (host) => {
        tried.push(host ?? "old");
        return new TcpTransport({
          host: "127.0.0.1",
          port: host === NEW_HOST ? node.port : dead,
          connectTimeoutMs: 2_000,
          keepAliveMs: 15_000,
        });
      },
      timing: {
        configTimeoutMs: 30_000,
        heartbeatIntervalMs: 60_000,
        backoffMinMs: 2_000,
        backoffMaxMs: 60_000,
      },
      clock,
      random: () => 0.5,
    });
    const moved: string[] = [];
    conn.on("addressChanged", ({ host }) => moved.push(host));
    conn.tryAlternateHost(NEW_HOST);
    expect(conn.pendingAlternateHost).toBe(NEW_HOST);
    conn.start();
    await until(() => conn.state === "reconnecting");
    clock.advance(60_000);
    await until(() => conn.state === "connected");
    expect(tried).toEqual(["old", NEW_HOST]);
    expect(moved).toEqual([NEW_HOST]);
    expect(conn.connection.host).toBe(NEW_HOST);
    expect(conn.pendingAlternateHost).toBeNull();
  });

  it("ignores the connection's own address", () => {
    node = new FakeNode();
    conn = new NodeConnection({
      connection: TEST_CONNECTION,
      createTransport: () => {
        throw new Error("not used");
      },
      timing: { configTimeoutMs: 1, heartbeatIntervalMs: 1, backoffMinMs: 1, backoffMaxMs: 1 },
    });
    conn.tryAlternateHost(TEST_CONNECTION.host);
    expect(conn.pendingAlternateHost).toBeNull();
  });
});
