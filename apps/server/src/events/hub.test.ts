import { describe, expect, it } from "vitest";
import { MemoryLogger } from "../logger.js";
import { EventHub, type AnyEvent } from "./hub.js";

interface TestEvents {
  ping: { n: number };
  pong: { text: string };
}

describe("EventHub", () => {
  it("delivers an event to every subscriber of that type", () => {
    const hub = new EventHub<TestEvents>();
    const a: number[] = [];
    const b: number[] = [];
    const pongs: string[] = [];
    hub.subscribe("ping", (p) => a.push(p.n));
    hub.subscribe("ping", (p) => b.push(p.n));
    hub.subscribe("pong", (p) => pongs.push(p.text));
    hub.publish("ping", { n: 1 });
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    expect(pongs).toEqual([]);
  });

  it("stops delivering after unsubscribe", () => {
    const hub = new EventHub<TestEvents>();
    const a: number[] = [];
    const b: number[] = [];
    const unsubscribeA = hub.subscribe("ping", (p) => a.push(p.n));
    hub.subscribe("ping", (p) => b.push(p.n));
    hub.publish("ping", { n: 1 });
    unsubscribeA();
    hub.publish("ping", { n: 2 });
    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
  });

  it("keeps delivering when a subscriber throws, and logs it", () => {
    const logger = new MemoryLogger();
    const hub = new EventHub<TestEvents>(logger);
    const got: number[] = [];
    hub.subscribe("ping", () => {
      throw new Error("boom");
    });
    hub.subscribe("ping", (p) => got.push(p.n));
    hub.publish("ping", { n: 7 });
    expect(got).toEqual([7]);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({ level: "error", obj: { event: "ping" } });
  });

  it("subscribeAll sees every event type in order", () => {
    const hub = new EventHub<TestEvents>();
    const seen: AnyEvent<TestEvents>[] = [];
    const unsubscribe = hub.subscribeAll((e) => seen.push(e));
    hub.publish("ping", { n: 1 });
    hub.publish("pong", { text: "x" });
    unsubscribe();
    hub.publish("ping", { n: 2 });
    expect(seen).toEqual([
      { type: "ping", payload: { n: 1 } },
      { type: "pong", payload: { text: "x" } },
    ]);
  });

  it("lets a handler unsubscribe itself during delivery without skipping others", () => {
    const hub = new EventHub<TestEvents>();
    const got: string[] = [];
    const off = hub.subscribe("ping", () => {
      got.push("once");
      off();
    });
    hub.subscribe("ping", () => got.push("always"));
    hub.publish("ping", { n: 1 });
    hub.publish("ping", { n: 2 });
    expect(got).toEqual(["once", "always", "always"]);
  });
});
