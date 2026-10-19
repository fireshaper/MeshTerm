import { until } from "@meshterm/fake-node";
import { describe, expect, it } from "vitest";
import { startTestApp } from "./test-app.js";

describe("buildApp", () => {
  it("starts against FakeNode, and close() drops every node socket", async () => {
    const { app, node } = await startTestApp();
    expect(app.meshterm.connections.size).toBe(1);
    expect(node.clientCount).toBe(1);

    await expect(app.close()).resolves.toBeUndefined();
    await until(() => node.clientCount === 0);
    expect(app.meshterm.connections.get(1)?.state).toBe("disconnected");
    await node.stop();
  });

  it("seeds the connection from the environment", async () => {
    const t = await startTestApp();
    const conn = t.app.meshterm.connections.get(1);
    expect(conn?.connection).toMatchObject({ host: "127.0.0.1", port: t.node.port });
    await t.close();
  });

  it("answers unknown routes with a JSON 404", async () => {
    const t = await startTestApp();
    const res = await t.app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "GET /nope not found" });
    await t.close();
  });
});
