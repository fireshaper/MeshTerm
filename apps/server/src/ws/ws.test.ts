import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";
import { WsTestClient } from "./test-client.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;

let t: TestApp;
let client: WsTestClient;

beforeEach(async () => {
  t = await startTestApp();
  await t.app.listen({ host: "127.0.0.1", port: 0 });
  client = await WsTestClient.open(t.app);
});

afterEach(async () => {
  client.close();
  await t.close();
});

describe("GET /ws", () => {
  it("answers subscribe with one snapshot built from the database", async () => {
    client.send({ type: "subscribe", connectionId: 1 });
    const snapshot = await client.next("snapshot");
    expect(snapshot).toMatchObject({ connectionId: 1, state: "connected", myNodeNum: ME });
    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.channels.map((c) => c.index)).toEqual([0, 1]);
    expect(snapshot.channelMessages).toEqual([
      { channelIndex: 0, messages: [] },
      { channelIndex: 1, messages: [] },
    ]);
    expect(client.ofType("snapshot")).toHaveLength(1);
  });

  it("then forwards message.new for that connection", async () => {
    client.send({ type: "subscribe", connectionId: 1 });
    await client.next("snapshot");
    t.node.injectText(RIDGE, { channel: 0 }, "hello ws");
    const event = await client.next("message.new");
    expect(event.message).toMatchObject({ fromNum: RIDGE, text: "hello ws", direction: "in" });
  });

  it("includes stored messages in the next snapshot, oldest first", async () => {
    client.send({ type: "subscribe", connectionId: 1 });
    await client.next("snapshot");
    t.node.injectText(RIDGE, { channel: 0 }, "one");
    await client.next("message.new");
    t.node.injectText(RIDGE, { to: ME }, "dm");
    await client.waitFor(() => client.ofType("message.new").length === 2);

    const later = await WsTestClient.open(t.app);
    later.send({ type: "subscribe", connectionId: 1 });
    const snapshot = await later.next("snapshot");
    expect(snapshot.channelMessages[0]?.messages.map((m) => m.text)).toEqual(["one"]);
    expect(snapshot.dmMessages).toEqual([
      { peer: RIDGE, messages: [expect.objectContaining({ text: "dm" })] },
    ]);
    later.close();
  });

  it("answers malformed JSON with an error frame and keeps the socket open", async () => {
    client.send("{not json");
    const error = await client.next("error");
    expect(error.code).toBe("bad_json");
    expect(client.isOpen).toBe(true);

    client.send({ type: "subscribe", connectionId: 1 });
    await client.next("snapshot");
  });

  it("rejects unknown message types and unknown connections with error frames", async () => {
    client.send({ type: "dance" });
    expect((await client.next("error")).code).toBe("bad_message");
    const seen = client.messages.length;
    client.send({ type: "subscribe", connectionId: 42 });
    expect((await client.next("error", seen)).code).toBe("unknown_connection");
    expect(client.isOpen).toBe(true);
  });

  it("sends nothing to a socket that hasn't subscribed", async () => {
    t.node.injectText(RIDGE, { channel: 0 }, "unheard");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.messages).toEqual([]);
  });
});
