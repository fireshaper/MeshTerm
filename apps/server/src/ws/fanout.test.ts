import { until } from "@meshterm/fake-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";
import { WsTestClient } from "./test-client.js";

const RIDGE = 0x0badcafe;

let t: TestApp;
let a: WsTestClient;
let b: WsTestClient;

async function subscribed(): Promise<WsTestClient> {
  const client = await WsTestClient.open(t.app);
  client.send({ type: "subscribe", connectionId: 1 });
  await client.next("snapshot");
  return client;
}

beforeEach(async () => {
  t = await startTestApp();
  await t.app.listen({ host: "127.0.0.1", port: 0 });
  a = await subscribed();
  b = await subscribed();
});

afterEach(async () => {
  a.close();
  b.close();
  await t.close();
});

describe("WS fan-out", () => {
  it("sends the same message.new to every subscribed client", async () => {
    t.node.injectText(RIDGE, { channel: 0 }, "to everyone");
    const [fromA, fromB] = await Promise.all([a.next("message.new"), b.next("message.new")]);
    expect(fromA).toEqual(fromB);
    expect(fromA.message.text).toBe("to everyone");
  });

  it("keeps delivering to the others when one client drops abruptly mid-stream", async () => {
    t.node.injectText(RIDGE, { channel: 0 }, "first");
    a.terminate();
    t.node.injectText(RIDGE, { channel: 0 }, "second");
    t.node.injectText(RIDGE, { channel: 0 }, "third");
    await b.waitFor(() => b.ofType("message.new").length === 3);
    expect(b.ofType("message.new").map((m) => m.message.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("broadcasts connection.state to every client through a node reboot", async () => {
    const start = { a: a.messages.length, b: b.messages.length };
    await t.node.reboot(300);
    await until(() => t.app.meshterm.connections.get(1)?.state === "connected", 5_000);
    for (const [client, from] of [
      [a, start.a],
      [b, start.b],
    ] as const) {
      await client.waitFor(() =>
        client.messages
          .slice(from)
          .some((m) => m.type === "connection.state" && m.state === "connected"),
      );
      const states = client.ofType("connection.state").map((m) => m.state);
      expect(states[0]).toBe("reconnecting");
      expect(states.slice(-3)).toEqual(["connecting", "configuring", "connected"]);
    }
  });
});
