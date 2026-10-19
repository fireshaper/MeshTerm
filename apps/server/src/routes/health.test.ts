import { until } from "@meshterm/fake-node";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";

let t: TestApp;

afterEach(async () => {
  await t.close();
});

describe("GET /healthz", () => {
  it("reports connected while FakeNode is up", async () => {
    t = await startTestApp();
    const res = await t.app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      connections: [{ id: 1, name: "Primary node", state: "connected" }],
    });
  });

  it("still answers 200, with reconnecting, after FakeNode stops", async () => {
    t = await startTestApp();
    await t.node.stop();
    await until(() => t.app.meshterm.connections.get(1)?.state === "reconnecting");
    const res = await t.app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ connections: [{ id: 1, state: "reconnecting" }] });
  });
});
