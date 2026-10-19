import { auditInbound, until } from "@meshterm/fake-node";
import type { Message } from "@meshterm/shared";
import { afterEach, describe, expect, it } from "vitest";
import { getMessage } from "../db/repositories.js";
import { startTestApp, type TestApp } from "../test-app.js";
import { WsTestClient } from "../ws/test-client.js";

const RIDGE = 0x0badcafe;

let t: TestApp;
let ws: WsTestClient;

afterEach(async () => {
  ws.close();
  await t.close();
});

async function setup(env: Record<string, string> = {}) {
  t = await startTestApp({ env });
  await t.app.listen({ host: "127.0.0.1", port: 0 });
  ws = await WsTestClient.open(t.app);
  ws.send({ type: "subscribe", connectionId: 1 });
  await ws.next("snapshot");
}

const post = (body: unknown) =>
  t.app.inject({ method: "POST", url: "/api/connections/1/messages", payload: body as object });

/** Statuses the WS client has seen for one message: message.new first, then each message.status. */
function statusTrail(id: string): (string | null)[] {
  return ws.messages.flatMap((m) => {
    if (m.type === "message.new" && m.message.id === id) return [m.message.status];
    if (m.type === "message.status" && m.messageId === id) return [m.status];
    return [];
  });
}

describe("POST /api/connections/:id/messages", () => {
  it("ack: queued → sent → acked, and the packet reaches the node with want_ack", async () => {
    await setup();
    t.node.setAckMode("ack");
    const res = await post({ text: "hello mesh", to: RIDGE });
    expect(res.statusCode).toBe(201);
    const { message } = res.json<{ message: Message }>();
    expect(message).toMatchObject({
      direction: "out",
      fromNum: 0xa1b2c3d4,
      toNum: RIDGE,
      peer: RIDGE,
      text: "hello mesh",
    });
    expect(message.packetId).toBeGreaterThan(0);

    await ws.waitFor(() => statusTrail(message.id).includes("acked"));
    expect(statusTrail(message.id)).toEqual(["queued", "sent", "acked"]);
    expect(getMessage(t.app.meshterm.db, message.id)?.status).toBe("acked");

    const sent = t.node.inbound.flatMap((e) =>
      e.message.payloadVariant.case === "packet" ? [e.message.payloadVariant.value] : [],
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: message.packetId, to: RIDGE, wantAck: true });
  });

  it("nak: the client sees failed", async () => {
    await setup();
    t.node.setAckMode("nak");
    const { message } = (await post({ text: "doomed", channel: 0 })).json<{ message: Message }>();
    await ws.waitFor(() => statusTrail(message.id).includes("failed"));
    expect(statusTrail(message.id)).toEqual(["queued", "sent", "failed"]);
  });

  it("silent: with a short ACK timeout the client sees failed", async () => {
    await setup({ MESHTERM_ACK_TIMEOUT_MS: "300" });
    t.node.setAckMode("silent");
    const { message } = (await post({ text: "anyone?", to: RIDGE })).json<{ message: Message }>();
    await ws.waitFor(() => statusTrail(message.id).includes("failed"));
    expect(statusTrail(message.id)).toEqual(["queued", "sent", "failed"]);
  });

  it("rejects empty, over-long and ambiguous messages with 400 and sends nothing", async () => {
    await setup();
    t.node.clearInbound();
    for (const body of [
      { text: "x".repeat(300), channel: 0 },
      { text: "é".repeat(101), channel: 0 }, // 202 UTF-8 bytes, 101 characters
      { text: "", channel: 0 },
      { text: "   ", channel: 0 },
      { text: "both", channel: 0, to: RIDGE },
      { text: "neither" },
      { text: "broadcast as dm", to: 0xffff_ffff },
    ]) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json(), JSON.stringify(body)).toMatchObject({ error: "bad_request" });
    }
    expect((await post({ text: "é".repeat(100), channel: 0 })).statusCode).toBe(201);
    await until(() => t.node.inbound.length === 1);
  });

  it("returns 404 for an unknown connection", async () => {
    await setup();
    const res = await t.app.inject({
      method: "POST",
      url: "/api/connections/9/messages",
      payload: { text: "hi", channel: 0 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 while the node is down, and the node never receives it", async () => {
    await setup();
    const rebooted = t.node.reboot(1_000);
    await until(() => t.app.meshterm.connections.get(1)?.state !== "connected");
    const res = await post({ text: "into the void", channel: 0 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "not_connected" });

    await rebooted;
    await until(() => t.app.meshterm.connections.get(1)?.state === "connected", 5_000);
    expect(auditInbound(t.node.inbound).counts.transmit).toBe(0);
  });
});
