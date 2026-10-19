import { auditInbound, FakeNode, until } from "@meshterm/fake-node";
import { afterEach, describe, expect, it } from "vitest";
import { TcpTransport } from "../transport/tcp-transport.js";
import { NodeConnection } from "./node-connection.js";
import { recordConnection, TEST_CONNECTION } from "./test-helpers.js";

let node: FakeNode;
let conn: NodeConnection;

afterEach(async () => {
  await conn.stop();
  await node.stop();
});

describe("NodeConnection recovers from a node reboot", () => {
  it("reconnects, re-handshakes, rebuilds the model and transmits nothing", async () => {
    node = new FakeNode();
    await node.start();
    conn = new NodeConnection({
      connection: TEST_CONNECTION,
      createTransport: () =>
        new TcpTransport({
          host: "127.0.0.1",
          port: node.port,
          connectTimeoutMs: 1_000,
          keepAliveMs: 15_000,
        }),
      timing: {
        configTimeoutMs: 2_000,
        heartbeatIntervalMs: 60_000,
        backoffMinMs: 100,
        backoffMaxMs: 400,
      },
    });
    const rec = recordConnection(conn);

    conn.start();
    await until(() => conn.state === "connected", 5_000);
    expect(conn.model.nodes.size).toBe(4);
    expect(conn.model.myInfo?.rebootCount).toBe(3);
    const before = rec.states.length;

    const rebooted = node.reboot(1_000);
    // While the node is down it learns a new neighbor; only a fresh handshake shows it.
    node.injectNodeInfo({ num: 0x77777777, user: { id: "!77777777", longName: "Newcomer" } });
    await rebooted;
    await until(() => conn.state === "connected" && rec.states.length > before, 10_000);

    const after = rec.stateNames().slice(before);
    expect(after[0]).toBe("reconnecting");
    expect(after.slice(-3)).toEqual(["connecting", "configuring", "connected"]);
    // Between the drop and the final handshake: only failed attempts while the node was down.
    for (const state of after.slice(1, -3)) expect(["connecting", "reconnecting"]).toContain(state);

    expect(conn.model.nodes.size).toBe(5);
    expect(conn.model.nodes.has(0x77777777)).toBe(true);
    expect(conn.model.myInfo?.rebootCount).toBe(4);
    expect(conn.model.myNodeNum).toBe(0xa1b2c3d4);

    const audit = auditInbound(node.inbound);
    expect(audit.counts.transmit).toBe(0);
    expect(audit.counts.handshake).toBe(2);
  }, 20_000);
});
