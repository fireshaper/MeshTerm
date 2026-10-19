import { FakeNode, until } from "@meshterm/fake-node";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import { TcpTransport } from "../transport/tcp-transport.js";
import { NodeConnection } from "./node-connection.js";
import { recordConnection, TEST_CONNECTION } from "./test-helpers.js";

const CONFIG_TIMEOUT = 30_000;

let node: FakeNode;
let conn: NodeConnection;

afterEach(async () => {
  await conn.stop();
  await node.stop();
});

async function setup(scenario = "default") {
  node = new FakeNode({ scenario });
  await node.start();
  const clock = new FakeClock();
  conn = new NodeConnection({
    connection: TEST_CONNECTION,
    createTransport: () =>
      new TcpTransport({
        host: "127.0.0.1",
        port: node.port,
        connectTimeoutMs: 2_000,
        keepAliveMs: 15_000,
      }),
    timing: {
      configTimeoutMs: CONFIG_TIMEOUT,
      heartbeatIntervalMs: 60_000,
      backoffMinMs: 2_000,
      backoffMaxMs: 60_000,
    },
    clock,
    random: () => 0.5,
  });
  const rec = recordConnection(conn);
  return { clock, rec };
}

describe("NodeConnection config handshake", () => {
  it("reaches connected with the scenario's nodes, channels and node number", async () => {
    const { rec } = await setup();
    conn.start();
    await until(() => conn.state === "connected");
    expect(rec.stateNames()).toEqual(["connecting", "configuring", "connected"]);

    expect(conn.model.myNodeNum).toBe(0xa1b2c3d4);
    expect(conn.model.nodes.size).toBe(4);
    expect([...conn.model.channels.keys()]).toEqual([0, 1]);
    expect(conn.model.metadata?.firmwareVersion).toBe("2.7.15.fake");

    // It sent exactly one want_config_id, and the completion matched it.
    const nonces = node.inbound.flatMap((e) =>
      e.message.payloadVariant.case === "wantConfigId" ? [e.message.payloadVariant.value] : [],
    );
    expect(nonces).toHaveLength(1);
    expect(rec.states[2]?.reason).toBe(`config_complete_id ${nonces[0] ?? -1}`);
  });

  it("records when it entered its current state", async () => {
    const { clock } = await setup();
    const startedAt = clock.now();
    expect(conn.stateSince).toBe(startedAt);
    conn.start();
    await until(() => conn.state === "connected");
    clock.advance(5_000);
    expect(conn.stateSince).toBe(startedAt); // the fake clock only moved after connecting
    await conn.stop();
    expect(conn.stateSince).toBe(startedAt + 5_000);
  });

  it("builds the model from whichever scenario the node has", async () => {
    await setup("busy");
    conn.start();
    await until(() => conn.state === "connected");
    expect(conn.model.nodes.size).toBe(8);
    expect(conn.model.channels.size).toBe(1);
  });

  it("ignores a wrong config_complete_id and gives up after the timeout", async () => {
    const { clock, rec } = await setup();
    node.setConfigCompleteMode("wrong");
    conn.start();
    await until(() => conn.state === "configuring");
    // Let the whole handshake reply (with the wrong id) arrive.
    await until(() => node.inbound.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(conn.state).toBe("configuring");

    clock.advance(CONFIG_TIMEOUT - 1);
    expect(conn.state).toBe("configuring");
    clock.advance(1);
    expect(conn.state).toBe("reconnecting");
    expect(rec.states.at(-1)?.reason).toMatch(/no config_complete_id \d+ within 30000 ms/);
    // The model is untouched by an unfinished handshake.
    expect(conn.model.nodes.size).toBe(0);
    await until(() => node.clientCount === 0);
  });

  it("stop() while connected closes the link and ends disconnected", async () => {
    const { rec } = await setup();
    conn.start();
    await until(() => conn.state === "connected");
    await conn.stop();
    expect(conn.state).toBe("disconnected");
    expect(rec.states.at(-1)).toEqual({
      previous: "connected",
      state: "disconnected",
      reason: "stopped",
    });
    await until(() => node.clientCount === 0);
  });
});
