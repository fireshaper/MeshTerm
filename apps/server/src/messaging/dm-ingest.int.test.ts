// Regression for messages-spec §1: DMs are stored with the right `peer`, kept out of
// channel threads, and carry their PKI / reply / reaction fields.
import { until } from "@meshterm/fake-node";
import { Portnums } from "@meshterm/protocol";
import type { Message } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messages } from "../db/schema.js";
import { startTestApp, type TestApp } from "../test-app.js";
import { WsTestClient } from "../ws/test-client.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;

let t: TestApp;
let ws: WsTestClient;

beforeEach(async () => {
  t = await startTestApp();
  await t.app.listen({ host: "127.0.0.1", port: 0 });
  ws = await WsTestClient.open(t.app);
  ws.send({ type: "subscribe", connectionId: 1 });
  await ws.next("snapshot");
});

afterEach(async () => {
  ws.close();
  await t.close();
});

const rows = () => t.app.meshterm.db.select().from(messages).all();
const row = (text: string) => rows().find((m) => m.text === text);
const history = async (query: string) =>
  (await t.app.inject({ url: `/api/connections/1/messages?${query}` })).json<{
    messages: Message[];
  }>().messages;

describe("DM ingest", () => {
  it("stores PKI and legacy incoming DMs under the sender, never in a channel thread", async () => {
    t.node.injectText(RIDGE, { to: ME }, "pki dm", { pkiEncrypted: true });
    t.node.injectText(TRAIL, { to: ME }, "legacy dm");
    t.node.injectText(RIDGE, { channel: 1 }, "on secondary");
    await until(() => rows().length === 3, 2_000);

    expect(row("pki dm")).toMatchObject({ peer: RIDGE, direction: "in", pkiEncrypted: true });
    expect(row("legacy dm")).toMatchObject({ peer: TRAIL, direction: "in", pkiEncrypted: false });
    expect(row("on secondary")).toMatchObject({ peer: null, channelIndex: 1 });

    expect((await history(`peer=${RIDGE}`)).map((m) => m.text)).toEqual(["pki dm"]);
    expect((await history(`peer=${TRAIL}`)).map((m) => m.text)).toEqual(["legacy dm"]);
    expect((await history("channel=0")).map((m) => m.text)).toEqual([]);
    expect((await history("channel=1")).map((m) => m.text)).toEqual(["on secondary"]);
  });

  it("a PKI DM with an out-of-range channel value still lands", async () => {
    t.node.sendFromRadio({
      case: "packet",
      value: {
        from: RIDGE,
        to: ME,
        channel: 0x5a,
        id: 777,
        rxTime: Math.floor(Date.now() / 1000),
        pkiEncrypted: true,
        payloadVariant: {
          case: "decoded",
          value: {
            portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
            payload: new TextEncoder().encode("odd channel"),
          },
        },
      },
    });
    await until(() => row("odd channel") !== undefined, 2_000);
    expect(row("odd channel")).toMatchObject({ peer: RIDGE, channelIndex: 0 });
  });

  it("a DM the node couldn't decrypt shows up in the activity feed", async () => {
    t.node.sendFromRadio({
      case: "packet",
      value: {
        from: TRAIL,
        to: ME,
        channel: 0x5a,
        id: 888,
        payloadVariant: { case: "encrypted", value: new Uint8Array([1, 2, 3, 4]) },
      },
    });
    const feed = async () =>
      (await t.app.inject({ url: "/api/connections/1/events" })).json<{
        events: { kind: string; nodeNum: number | null }[];
      }>().events;
    await expect
      .poll(async () => (await feed()).find((e) => e.kind === "message.undecryptable")?.nodeNum)
      .toBe(TRAIL);
    expect(rows()).toHaveLength(0);
  });

  it("a DM our own node sent from another client is an outgoing DM to the recipient", async () => {
    t.node.injectText(ME, { to: TRAIL }, "sent from my phone");
    await until(() => row("sent from my phone") !== undefined, 2_000);
    expect(row("sent from my phone")).toMatchObject({ peer: TRAIL, direction: "out" });
  });

  it("stores replies, reactions, MQTT and hops; a duplicate is dropped", async () => {
    const parent = t.node.injectText(RIDGE, { to: ME }, "parent", { hopsAway: 2 });
    t.node.injectText(RIDGE, { to: ME }, "a reply", { replyId: parent, viaMqtt: true });
    t.node.injectText(RIDGE, { to: ME }, "👍", { replyId: parent, emoji: true });
    t.node.injectText(RIDGE, { to: ME }, "parent", { packetId: parent });
    await until(() => rows().length >= 3, 2_000);
    await new Promise((r) => setTimeout(r, 200));

    expect(rows()).toHaveLength(3);
    expect(row("parent")).toMatchObject({ hopStart: 3, hopLimit: 1, replyId: null, emoji: false });
    expect(row("a reply")).toMatchObject({ replyId: parent, viaMqtt: true, emoji: false });
    expect(row("👍")).toMatchObject({ replyId: parent, emoji: true });
  });

  it("an outgoing DM is acked; a NAK stores its reason and sends it to clients", async () => {
    t.node.setAckMode("ack");
    const post = (text: string) =>
      t.app.inject({
        method: "POST",
        url: "/api/connections/1/messages",
        payload: { text, to: RIDGE },
      });
    const acked = (await post("ack me")).json<{ message: Message }>().message;
    await until(() => row("ack me")?.status === "acked", 2_000);
    expect(row("ack me")).toMatchObject({ peer: RIDGE, direction: "out", errorReason: null });

    t.node.setAckMode("nak", 0, "NO_RESPONSE");
    const failed = (await post("nobody home")).json<{ message: Message }>().message;
    await until(() => row("nobody home")?.status === "failed", 2_000);
    expect(row("nobody home")?.errorReason).toBe("NO_RESPONSE");
    await ws.waitFor(() =>
      ws.messages.some(
        (m) =>
          m.type === "message.status" &&
          m.messageId === failed.id &&
          m.errorReason === "NO_RESPONSE",
      ),
    );
    expect(acked.id).not.toBe(failed.id);
  });
});
