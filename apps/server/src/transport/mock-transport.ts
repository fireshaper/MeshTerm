import { EventEmitter } from "node:events";
import {
  decodeFromRadio,
  decodeToRadio,
  encodeFromRadio,
  encodeToRadio,
  type FromRadioVariant,
  type ToRadio,
  type ToRadioInit,
} from "@meshterm/protocol";
import type { Transport, TransportEvents } from "./transport.js";

/** The node end of an in-memory link. Messages go through the real codec. */
export class MockPeer {
  readonly received: ToRadio[] = [];
  /** When false, `connect()` on a new transport rejects. */
  reachable = true;
  /** Called with each `ToRadio` as it arrives, e.g. to script a handshake reply. */
  onReceive: ((message: ToRadio) => void) | null = null;
  private transport: MockTransport | null = null;

  get connections(): number {
    return this.transport ? 1 : 0;
  }

  createTransport(): MockTransport {
    return new MockTransport(this);
  }

  sendFromRadio(payloadVariant: FromRadioVariant): void {
    this.sendBytes(encodeFromRadio({ payloadVariant }));
  }

  /** Delivers raw payload bytes, e.g. ones that won't decode. */
  sendBytes(bytes: Uint8Array): void {
    const transport = this.transport;
    setImmediate(() => transport?.deliver(bytes));
  }

  /** Ends the link from the node's side. */
  close(): void {
    const transport = this.transport;
    this.transport = null;
    setImmediate(() => transport?.peerClosed());
  }

  /** @internal */
  receive(message: ToRadio): void {
    this.received.push(message);
    this.onReceive?.(message);
  }

  /** @internal */
  attach(transport: MockTransport): void {
    this.transport = transport;
  }

  /** @internal */
  detach(transport: MockTransport): void {
    if (this.transport === transport) this.transport = null;
  }
}

export class MockTransport extends EventEmitter<TransportEvents> implements Transport {
  private open = false;
  private done = false;

  constructor(private readonly peer: MockPeer) {
    super();
  }

  get isOpen(): boolean {
    return this.open;
  }

  async connect(): Promise<void> {
    if (this.done) throw new Error("transport already used");
    await new Promise((resolve) => setImmediate(resolve));
    if (!this.peer.reachable) {
      this.done = true;
      throw new Error("mock peer unreachable");
    }
    this.peer.attach(this);
    this.open = true;
    this.emit("open");
  }

  disconnect(): Promise<void> {
    this.done = true;
    if (this.open) {
      this.open = false;
      this.peer.detach(this);
    }
    return Promise.resolve();
  }

  send(message: ToRadioInit): void {
    if (!this.open) throw new Error("transport is not open");
    const bytes = encodeToRadio(message);
    setImmediate(() => {
      this.peer.receive(decodeToRadio(bytes));
    });
  }

  /** @internal */
  deliver(bytes: Uint8Array): void {
    if (!this.open) return;
    try {
      this.emit("fromRadio", decodeFromRadio(bytes));
    } catch (err) {
      if (this.listenerCount("error") > 0) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /** @internal */
  peerClosed(): void {
    if (!this.open) return;
    this.open = false;
    this.done = true;
    this.emit("close", { reason: "peer-closed", error: null });
  }
}
