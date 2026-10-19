import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";
import { SEND_RATE_LIMIT } from "./send.js";

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp();
});

afterEach(async () => {
  await t.close();
});

describe("send rate limit", () => {
  it("returns 429 for one request over the limit; reads are unaffected", async () => {
    t.node.clearInbound();
    // Invalid bodies still count toward the limit and transmit nothing.
    const send = () =>
      t.app.inject({
        method: "POST",
        url: "/api/connections/1/messages",
        payload: { text: "", channel: 0 },
      });
    for (let i = 0; i < SEND_RATE_LIMIT.max; i++) expect((await send()).statusCode).toBe(400);

    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: "rate_limited",
      message: "Rate limit exceeded, retry in 1 minute",
    });
    expect(limited.headers["retry-after"]).toBeDefined();

    for (let i = 0; i < SEND_RATE_LIMIT.max + 5; i++) {
      expect(
        (await t.app.inject({ method: "GET", url: "/api/connections/1/nodes" })).statusCode,
      ).toBe(200);
      expect((await t.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    }
    expect(t.node.inbound).toEqual([]);
  });
});
