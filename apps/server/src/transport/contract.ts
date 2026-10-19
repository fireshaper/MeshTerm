import { until } from "@meshterm/fake-node";
import type { FromRadioVariant, ToRadio } from "@meshterm/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Transport, TransportEvents } from "./transport.js";

/** What the contract suite needs from the other end of a transport. */
export interface ContractHarness {
  createTransport(): Transport;
  /** A transport whose `connect()` must fail (nothing listening, peer unreachable). */
  createUnreachableTransport(): Transport;
  sendFromRadio(payloadVariant: FromRadioVariant): void;
  /** Every `ToRadio` the peer has decoded so far. */
  received(): readonly ToRadio[];
  /** Ends the link from the node's side. */
  closeFromPeer(): void;
  /** Links the peer currently has open. */
  peerConnections(): number;
  teardown(): Promise<void>;
}

type Recorded = {
  [E in keyof TransportEvents]: { event: E; args: TransportEvents[E] };
}[keyof TransportEvents];

function record(transport: Transport): Recorded[] {
  const events: Recorded[] = [];
  transport.on("open", () => events.push({ event: "open", args: [] }));
  transport.on("fromRadio", (m) => events.push({ event: "fromRadio", args: [m] }));
  transport.on("close", (c) => events.push({ event: "close", args: [c] }));
  transport.on("error", (e) => events.push({ event: "error", args: [e] }));
  return events;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** The behavior every `Transport` must have; see the contract on the interface. */
export function describeTransportContract(
  name: string,
  setup: () => Promise<ContractHarness>,
): void {
  describe(`Transport contract: ${name}`, () => {
    let h: ContractHarness;
    let transport: Transport;
    let events: Recorded[];

    beforeEach(async () => {
      h = await setup();
      transport = h.createTransport();
      events = record(transport);
    });

    afterEach(async () => {
      await transport.disconnect();
      await h.teardown();
    });

    it("connect() emits open once and resolves", async () => {
      expect(transport.isOpen).toBe(false);
      await transport.connect();
      expect(transport.isOpen).toBe(true);
      expect(events.map((e) => e.event)).toEqual(["open"]);
      await until(() => h.peerConnections() === 1);
    });

    it("emits a decoded FromRadio", async () => {
      await transport.connect();
      await until(() => h.peerConnections() === 1);
      h.sendFromRadio({ case: "myInfo", value: { myNodeNum: 0xa1b2c3d4 } });
      await until(() => events.some((e) => e.event === "fromRadio"));
      const got = events.find((e) => e.event === "fromRadio");
      const variant = got?.event === "fromRadio" ? got.args[0].payloadVariant : undefined;
      expect(variant?.case === "myInfo" && variant.value.myNodeNum).toBe(0xa1b2c3d4);
    });

    it("send() arrives at the peer", async () => {
      await transport.connect();
      transport.send({ payloadVariant: { case: "heartbeat", value: { nonce: 7 } } });
      await until(() => h.received().length === 1);
      const variant = h.received()[0]?.payloadVariant;
      expect(variant?.case === "heartbeat" && variant.value.nonce).toBe(7);
    });

    it("peer close emits close once and the link is down", async () => {
      await transport.connect();
      await until(() => h.peerConnections() === 1);
      h.closeFromPeer();
      await until(() => events.some((e) => e.event === "close"));
      await settle();
      const closes = events.filter((e) => e.event === "close");
      expect(closes).toHaveLength(1);
      expect(closes[0]?.args[0]).toMatchObject({ reason: "peer-closed" });
      expect(transport.isOpen).toBe(false);
      expect(() => {
        transport.send({ payloadVariant: { case: "heartbeat", value: {} } });
      }).toThrow();
    });

    it("disconnect() closes cleanly with no further events", async () => {
      await transport.connect();
      await until(() => h.peerConnections() === 1);
      events.length = 0;
      await transport.disconnect();
      expect(transport.isOpen).toBe(false);
      await until(() => h.peerConnections() === 0);
      h.sendFromRadio({ case: "myInfo", value: { myNodeNum: 1 } });
      await settle();
      expect(events).toEqual([]);
      await transport.disconnect(); // idempotent
    });

    it("disconnect() before connect() is a no-op", async () => {
      await transport.disconnect();
      expect(events).toEqual([]);
    });

    it("connect() to an unreachable peer rejects without events", async () => {
      const dead = h.createUnreachableTransport();
      const deadEvents = record(dead);
      await expect(dead.connect()).rejects.toThrow();
      await settle();
      expect(deadEvents).toEqual([]);
      expect(dead.isOpen).toBe(false);
    });
  });
}
