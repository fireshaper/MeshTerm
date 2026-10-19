import { auditInbound, FakeNode, until } from "@meshterm/fake-node";
import type { DashboardDTO, MeshNode } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";

const RIDGE = 0x0badcafe; // a favorite on the device
const TRAIL = 0x1a2b3c4d; // not a favorite on the device

let t: TestApp;
let upserts: MeshNode[];

beforeEach(async () => {
  t = await startTestApp({ node: new FakeNode({ scenario: "dashboard" }) });
  upserts = [];
  t.app.meshterm.hub.subscribe("node.upsert", ({ node }) => upserts.push(node));
});

afterEach(async () => {
  await t.close();
});

const setFavorite = (num: number, favorite: unknown, connection = 1) =>
  t.app.inject({
    method: "PUT",
    url: `/api/connections/${connection}/nodes/${num}/favorite`,
    payload: { favorite },
  });

async function favoriteOf(num: number): Promise<boolean | undefined> {
  const res = await t.app.inject({ method: "GET", url: "/api/connections/1/dashboard" });
  return res.json<DashboardDTO>().nodes.find((n) => n.num === num)?.isFavorite;
}

describe("PUT /api/connections/:id/nodes/:num/favorite", () => {
  it("sets the flag, emits one node.upsert and transmits nothing", async () => {
    t.node.clearInbound();
    const res = await setFavorite(TRAIL, true);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ node: MeshNode }>().node).toMatchObject({ num: TRAIL, isFavorite: true });
    expect(upserts.filter((n) => n.num === TRAIL)).toEqual([
      expect.objectContaining({ num: TRAIL, isFavorite: true }),
    ]);
    expect(await favoriteOf(TRAIL)).toBe(true);
    expect(auditInbound(t.node.inbound).counts.transmit).toBe(0);
  });

  it("wins over the device's flag across a node reboot and new handshake", async () => {
    await setFavorite(TRAIL, true);
    await setFavorite(RIDGE, false);
    await t.node.reboot(300);
    const conn = t.app.meshterm.connections.get(1);
    await until(() => conn?.state === "reconnecting", 3_000);
    await until(() => conn?.state === "connected", 5_000);
    expect(await favoriteOf(TRAIL)).toBe(true);
    expect(await favoriteOf(RIDGE)).toBe(false);
  });

  it("rejects unknown nodes and connections, and bad bodies", async () => {
    expect((await setFavorite(0x12345678, true)).statusCode).toBe(404);
    expect((await setFavorite(TRAIL, true, 9)).statusCode).toBe(404);
    expect((await setFavorite(TRAIL, "yes")).statusCode).toBe(400);
    expect(upserts.filter((n) => n.num === TRAIL)).toEqual([]);
  });
});
