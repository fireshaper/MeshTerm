import { until } from "@meshterm/fake-node";
import type { Channel, ConversationsDTO, MeshNode } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messages } from "../db/schema.js";
import { startTestApp, type TestApp } from "../test-app.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp();
});

afterEach(async () => {
  await t.close();
});

const get = async <T>(path: string) =>
  (await t.app.inject({ url: `/api/connections/1/${path}` })).json<T>();
const count = () => t.app.meshterm.db.select().from(messages).all().length;

describe("GET /api/connections/:id/conversations", () => {
  it("lists channels (preset name for the unnamed primary) and DMs newest first", async () => {
    t.node.injectText(TRAIL, { to: ME }, "older dm");
    await until(() => count() === 1, 2_000);
    await new Promise((r) => setTimeout(r, 1_100)); // rx_time has 1 s resolution
    t.node.injectText(RIDGE, { to: ME }, "newer dm", { pkiEncrypted: true });
    t.node.injectText(RIDGE, { channel: 1 }, "hello friends");
    await until(() => count() === 3, 2_000);

    const dto = await get<ConversationsDTO>("conversations");
    expect(dto.channels).toEqual([
      { index: 0, name: "LongFast", role: "PRIMARY", encryption: "default", lastMessage: null },
      {
        index: 1,
        name: "Friends",
        role: "SECONDARY",
        encryption: "custom",
        lastMessage: expect.objectContaining({ text: "hello friends", direction: "in" }) as unknown,
      },
    ]);
    expect(dto.dms.map((d) => [d.peer, d.lastMessage.text, d.lastMessage.pkiEncrypted])).toEqual([
      [RIDGE, "newer dm", true],
      [TRAIL, "older dm", false],
    ]);
  });

  it("is 404 for an unknown connection", async () => {
    const res = await t.app.inject({ url: "/api/connections/99/conversations" });
    expect(res.statusCode).toBe(404);
  });
});

describe("handshake metadata", () => {
  it("stores channel encryption kinds and which nodes have a public key, never the PSK", async () => {
    const channels = await get<Channel[]>("channels");
    expect(channels.map((c) => c.encryption)).toEqual(["default", "custom"]);
    expect(JSON.stringify(channels)).not.toContain("psk");
    const nodes = await get<MeshNode[]>("nodes");
    expect(nodes.find((n) => n.num === RIDGE)?.hasPublicKey).toBe(true);
    expect(nodes.find((n) => n.num === TRAIL)?.hasPublicKey).toBe(false);
  });
});
