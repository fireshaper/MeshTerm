import { FakeNode, until } from "@meshterm/fake-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import { Heartbeat } from "./heartbeat.js";
import { TcpTransport } from "./tcp-transport.js";

const INTERVAL = 60_000;

let node: FakeNode;
let transport: TcpTransport;
let heartbeat: Heartbeat;
let clock: FakeClock;

const heartbeats = () =>
  node.inbound.filter((e) => e.message.payloadVariant.case === "heartbeat").length;
// Real-time pause so any frame already written reaches FakeNode.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(async () => {
  // The heartbeat runs on a manual clock; sockets stay real.
  clock = new FakeClock();
  node = new FakeNode();
  await node.start();
  transport = new TcpTransport({
    host: "127.0.0.1",
    port: node.port,
    connectTimeoutMs: 2_000,
    keepAliveMs: 15_000,
  });
  await transport.connect();
  heartbeat = new Heartbeat(transport, INTERVAL, clock);
  heartbeat.start();
});

afterEach(async () => {
  heartbeat.stop();
  await transport.disconnect();
  await node.stop();
});

describe("Heartbeat", () => {
  it("sends none before the interval, one after one interval, three after three", async () => {
    clock.advance(INTERVAL - 1);
    await settle();
    expect(heartbeats()).toBe(0);

    clock.advance(1);
    await until(() => heartbeats() === 1);

    clock.advance(2 * INTERVAL);
    await until(() => heartbeats() === 3);
    await settle();
    expect(heartbeats()).toBe(3);
  });

  it("sends none after disconnect()", async () => {
    clock.advance(INTERVAL);
    await until(() => heartbeats() === 1);
    await transport.disconnect();
    clock.advance(5 * INTERVAL);
    await settle();
    expect(heartbeats()).toBe(1);
    expect(heartbeat.running).toBe(false);
  });

  it("stops when the node closes the link", async () => {
    node.dropClients();
    await until(() => !heartbeat.running);
    clock.advance(3 * INTERVAL);
    await settle();
    expect(heartbeats()).toBe(0);
  });
});
