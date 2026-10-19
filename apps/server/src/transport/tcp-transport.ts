import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import {
  decodeFromRadio,
  encodeFrame,
  encodeToRadio,
  StreamFramer,
  type ToRadioInit,
} from "@meshterm/protocol";
import type { Transport, TransportEvents } from "./transport.js";

export interface TcpTransportOptions {
  host: string;
  port: number;
  /** Give up on `connect()` after this long. */
  connectTimeoutMs: number;
  /** Idle time before the OS sends TCP keepalive probes. */
  keepAliveMs: number;
}

/** Meshtastic stream API over TCP (port 4403). See {@link Transport} for the contract. */
export class TcpTransport extends EventEmitter<TransportEvents> implements Transport {
  private socket: Socket | null = null;
  private open = false;
  private used = false;
  private userClosed = false;
  private lastError: Error | null = null;

  constructor(private readonly options: TcpTransportOptions) {
    super();
  }

  get isOpen(): boolean {
    return this.open;
  }

  connect(): Promise<void> {
    if (this.used) return Promise.reject(new Error("transport already used"));
    this.used = true;
    const { host, port, connectTimeoutMs, keepAliveMs } = this.options;
    const socket = new Socket();
    this.socket = socket;

    return new Promise((resolve, reject) => {
      const fail = (err: Error) => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        this.socket = null;
        reject(err);
      };
      const timer = setTimeout(() => {
        fail(new Error(`connect to ${host}:${port} timed out after ${connectTimeoutMs} ms`));
      }, connectTimeoutMs);
      socket.once("error", fail);
      socket.once("close", () => {
        fail(new Error(`connect to ${host}:${port} aborted`));
      });
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.setNoDelay(true);
        socket.setKeepAlive(true, keepAliveMs);
        this.attach(socket);
        this.open = true;
        this.emit("open");
        resolve();
      });
      socket.connect(port, host);
    });
  }

  async disconnect(): Promise<void> {
    this.used = true;
    this.userClosed = true;
    this.open = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.destroyed) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => {
        resolve();
      });
      socket.destroy();
    });
  }

  send(message: ToRadioInit): void {
    if (!this.open || !this.socket) throw new Error("transport is not open");
    this.socket.write(encodeFrame(encodeToRadio(message)));
  }

  private attach(socket: Socket): void {
    const framer = new StreamFramer();
    socket.on("data", (chunk: Buffer) => {
      for (const payload of framer.push(chunk)) {
        if (this.userClosed) return;
        try {
          this.emit("fromRadio", decodeFromRadio(payload));
        } catch (err) {
          this.reportError(err);
        }
      }
    });
    socket.on("error", (err) => {
      this.lastError = err;
      this.reportError(err);
    });
    socket.on("close", () => {
      if (this.userClosed) return;
      this.open = false;
      this.socket = null;
      const error = this.lastError;
      this.emit("close", { reason: error ? "error" : "peer-closed", error });
    });
  }

  private reportError(err: unknown): void {
    if (this.userClosed || this.listenerCount("error") === 0) return;
    this.emit("error", err instanceof Error ? err : new Error(String(err)));
  }
}
