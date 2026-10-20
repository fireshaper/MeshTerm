import { randomUUID } from "node:crypto";
import { BROADCAST_NUM, fixtures, type Message } from "@meshterm/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertMessage } from "../db/repositories.js";
import { startTestApp, type TestApp } from "../test-app.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
  const db = t.app.meshterm.db;
  const msg = (o: Partial<Message>): Message => ({
    ...fixtures.inboundMessage,
    id: randomUUID(),
    packetId: Math.floor(Math.random() * 1e9) + 1,
    ...o,
  });
  for (let i = 0; i < 60; i++) {
    insertMessage(db, msg({ fromNum: RIDGE, toNum: BROADCAST_NUM, peer: null, rxTime: 1_000 * i }));
  }
  insertMessage(db, msg({ fromNum: RIDGE, toNum: ME, peer: RIDGE, rxTime: 5 }));
});

afterAll(async () => {
  await t.close();
});

const get = (url: string) => t.app.inject({ method: "GET", url });

/** Every key at any depth of a JSON value. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
  }
  return [];
}

describe("REST read API", () => {
  it("GET /api/connections lists connections with live state", async () => {
    const res = await get("/api/connections");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: 1,
        name: "Primary node",
        host: "127.0.0.1",
        port: t.node.port,
        transport: "tcp",
        enabled: true,
        state: "connected",
        myNodeNum: ME,
      },
    ]);
  });

  it("GET /api/connections/:id/nodes returns the scenario's nodes", async () => {
    const res = await get("/api/connections/1/nodes");
    expect(res.statusCode).toBe(200);
    const nodes = res.json<{ num: number; id: string }[]>();
    expect(nodes).toHaveLength(4);
    expect(nodes.find((n) => n.num === RIDGE)?.id).toBe("!0badcafe");
  });

  it("GET /api/connections/:id/channels has no psk key at any depth", async () => {
    const res = await get("/api/connections/1/channels");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { connectionId: 1, index: 0, name: "", role: "PRIMARY", encryption: "default" },
      { connectionId: 1, index: 1, name: "Friends", role: "SECONDARY", encryption: "custom" },
    ]);
    expect(allKeys(res.json()).filter((k) => /psk/i.test(k))).toEqual([]);
  });

  it("GET messages by channel pages with nextCursor", async () => {
    const first = await get("/api/connections/1/messages?channel=0&limit=50");
    expect(first.statusCode).toBe(200);
    const page1 = first.json<{ messages: Message[]; nextCursor: string | null }>();
    expect(page1.messages).toHaveLength(50);
    expect(page1.messages[0]?.rxTime).toBe(59_000);
    expect(page1.nextCursor).not.toBeNull();

    const second = await get(
      `/api/connections/1/messages?channel=0&limit=50&before=${page1.nextCursor ?? ""}`,
    );
    const page2 = second.json<{ messages: Message[]; nextCursor: string | null }>();
    expect(page2.messages).toHaveLength(10);
    expect(page2.nextCursor).toBeNull();
  });

  it("GET messages by peer returns the DM conversation", async () => {
    const res = await get(`/api/connections/1/messages?peer=${RIDGE}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ messages: Message[] }>().messages.map((m) => m.peer)).toEqual([RIDGE]);
  });

  it("rejects both channel and peer, neither, a bad cursor and limit=500 with 400", async () => {
    for (const query of [
      `channel=0&peer=${RIDGE}`,
      "",
      "channel=0&limit=500",
      "channel=0&before=yesterday",
      "channel=9",
    ]) {
      const res = await get(`/api/connections/1/messages?${query}`);
      expect(res.statusCode, query).toBe(400);
      expect(res.json(), query).toMatchObject({ error: "bad_request" });
    }
  });

  it("returns a JSON 404 for an unknown connection id", async () => {
    for (const path of ["nodes", "channels", "messages?channel=0"]) {
      const res = await get(`/api/connections/99/${path}`);
      expect(res.statusCode, path).toBe(404);
      expect(res.json(), path).toEqual({ error: "not_found", message: "connection 99 not found" });
    }
  });

  it("returns 400 for a non-numeric connection id", async () => {
    expect((await get("/api/connections/abc/nodes")).statusCode).toBe(400);
  });
});
