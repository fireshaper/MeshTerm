import { FakeNode, until } from "@meshterm/fake-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeConnection } from "../connection/node-connection.js";
import { TEST_CONNECTION } from "../connection/test-helpers.js";
import type { DatabaseHandle } from "../db/database.js";
import { getMyNodeNum, getNode, listChannels, listNodes } from "../db/repositories.js";
import { messages } from "../db/schema.js";
import { openTestDatabase } from "../db/test-db.js";
import { TcpTransport } from "../transport/tcp-transport.js";
import { Hub, type PublicEvents } from "./events.js";
import { attachPersistence } from "./persistence.js";
import { wireConnection } from "./pipeline.js";

const RIDGE = 0x0badcafe;

let node: FakeNode;
let handle: DatabaseHandle;
let conn: NodeConnection;
let messageNew: PublicEvents["message.new"][];
let states: PublicEvents["connection.state"][];

beforeEach(async () => {
  node = new FakeNode();
  await node.start();
  handle = openTestDatabase();
  const hub = new Hub();
  attachPersistence(hub, handle.db);
  messageNew = [];
  states = [];
  hub.subscribe("message.new", (e) => messageNew.push(e));
  hub.subscribe("connection.state", (e) => states.push(e));
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
  wireConnection(conn, hub);
  conn.start();
  await until(() => conn.state === "connected", 5_000);
});

afterEach(async () => {
  await conn.stop();
  await node.stop();
  handle.close();
});

const messageRows = () => handle.db.select().from(messages).all();

describe("radio → hub → SQLite pipeline", () => {
  it("stores the handshake: my node number, nodes and channels", () => {
    expect(getMyNodeNum(handle.db, 1)).toBe(0xa1b2c3d4);
    expect(listNodes(handle.db, 1)).toHaveLength(4);
    expect(listChannels(handle.db, 1).map((c) => c.index)).toEqual([0, 1]);
    expect(states.map((s) => s.state)).toEqual(["connecting", "configuring", "connected"]);
  });

  it("stores an injected text within a second, once, and updates last heard", async () => {
    const heardBefore = getNode(handle.db, 1, RIDGE)?.lastHeard ?? 0;
    expect(heardBefore).toBeGreaterThan(0);

    node.injectText(RIDGE, { channel: 0 }, "hello pipeline", { packetId: 0xabc });
    await until(() => messageRows().length === 1, 1_000);
    expect(messageRows()[0]).toMatchObject({
      packetId: 0xabc,
      fromNum: RIDGE,
      peer: null,
      text: "hello pipeline",
      direction: "in",
    });

    // The same packet again, as if heard via a rebroadcast.
    node.injectText(RIDGE, { channel: 0 }, "hello pipeline", { packetId: 0xabc });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(messageRows()).toHaveLength(1);
    expect(messageNew).toHaveLength(1);

    expect(getNode(handle.db, 1, RIDGE)?.lastHeard ?? 0).toBeGreaterThan(heardBefore);
  });
});
