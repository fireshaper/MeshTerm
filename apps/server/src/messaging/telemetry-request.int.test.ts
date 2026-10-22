// CR-001 C4: Request telemetry against FakeNode. The one test file where a request
// deliberately goes out over the (fake) mesh.
import { auditInbound, until } from "@meshterm/fake-node";
import { Portnums } from "@meshterm/protocol";
import type { AuditPage, ServerMessage } from "@meshterm/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodes } from "../db/schema.js";
import { startTestApp, type TestApp } from "../test-app.js";

const ME = 0xa1b2c3d4;
const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;

let t: TestApp;
const events: ServerMessage[] = [];
beforeEach(async () => {
  t = await startTestApp();
  await until(() => t.app.meshterm.connections.get(1)?.state === "connected", 5_000);
  events.length = 0;
  t.app.meshterm.hub.subscribe("telemetry.request", (p) => {
    events.push({ type: "telemetry.request", ...p });
  });
});
afterEach(async () => {
  await t.close();
});

const request = (num: number, kind = "environment") =>
  t.app.inject({
    method: "POST",
    url: `/api/connections/1/nodes/${num}/request-telemetry`,
    payload: { kind },
  });

describe("POST …/nodes/:num/request-telemetry", () => {
  it("sends one TELEMETRY_APP request with want_response; the answer is stored and reported", async () => {
    t.node.clearInbound();
    const res = await request(RIDGE);
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toMatchObject({ timeoutMs: 60_000 });

    await until(() => auditInbound(t.node.inbound, ME).counts.transmit === 1, 2_000);
    const audit = auditInbound(t.node.inbound, ME);
    const packet = audit.transmits[0]?.message.payloadVariant;
    const p = packet?.case === "packet" ? packet.value : null;
    const data = p?.payloadVariant.case === "decoded" ? p.payloadVariant.value : null;
    expect(p?.to).toBe(RIDGE);
    expect(data?.portnum).toBe(Portnums.PortNum.TELEMETRY_APP);
    expect(data?.wantResponse).toBe(true);

    await until(
      () => events.some((e) => e.type === "telemetry.request" && e.state === "received"),
      3_000,
    );
    expect(events.map((e) => (e.type === "telemetry.request" ? e.state : ""))).toEqual([
      "sent",
      "received",
    ]);
    const detail = (await t.app.inject({ url: `/api/connections/1/nodes/${RIDGE}` })).json<{
      environment: { temperature: number | null } | null;
    }>();
    expect(detail.environment?.temperature).toBe(21.5);
    const audited = (await t.app.inject({ url: "/api/audit" })).json<AuditPage>();
    expect(audited.entries[0]).toMatchObject({
      action: "node.request-telemetry",
      target: "!0badcafe",
      details: { kind: "environment" },
    });
  });

  it("once per node per 5 minutes; never our own node, unknown nodes or far ones", async () => {
    expect((await request(RIDGE, "device")).statusCode).toBe(202);
    const again = await request(RIDGE, "device");
    expect(again.statusCode).toBe(429);
    expect(again.json<{ message: string }>().message).toMatch(/try again in 5 min/);
    expect((await request(ME)).statusCode).toBe(400);
    expect((await request(0x12345678)).statusCode).toBe(404);
    t.app.meshterm.db.update(nodes).set({ hopsAway: 4 }).where(eq(nodes.num, TRAIL)).run();
    const far = await request(TRAIL);
    expect(far.statusCode).toBe(400);
    expect(far.json<{ error: string }>().error).toBe("too_far");
    // Only the first one went out.
    await until(() => auditInbound(t.node.inbound, ME).transmits.length === 1, 2_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(auditInbound(t.node.inbound, ME).transmits).toHaveLength(1);
  });
});
