import type { AddressInfo } from "node:net";
import { ServerMessage, type ServerMessageOf, type ServerMessageType } from "@meshterm/shared";
import WebSocket from "ws";
import type { App } from "../app.js";
import { rawDataToString } from "./gateway.js";

/** A WebSocket test client. Every frame is validated against the shared `ServerMessage` schema. */
export class WsTestClient {
  readonly messages: ServerMessage[] = [];
  private readonly waiters = new Set<() => void>();

  private constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      this.messages.push(ServerMessage.parse(JSON.parse(rawDataToString(data))));
      for (const wake of [...this.waiters]) wake();
    });
  }

  /** Connects to `/ws` on an app that is listening. */
  static open(app: App): Promise<WsTestClient> {
    const { port } = app.server.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    return new Promise((resolve, reject) => {
      socket.once("open", () => {
        resolve(new WsTestClient(socket));
      });
      socket.once("error", reject);
    });
  }

  send(message: unknown): void {
    this.socket.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  ofType<T extends ServerMessageType>(type: T): ServerMessageOf<T>[] {
    return this.messages.filter((m): m is ServerMessageOf<T> => m.type === type);
  }

  async waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`WsTestClient.waitFor timed out after ${timeoutMs} ms`);
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, left);
        this.waiters.add(wake);
      });
    }
  }

  /** Waits for the first message of a type at or after index `from`. */
  async next<T extends ServerMessageType>(type: T, from = 0): Promise<ServerMessageOf<T>> {
    const find = () =>
      this.messages.slice(from).find((m): m is ServerMessageOf<T> => m.type === type);
    await this.waitFor(() => find() !== undefined);
    return find() as ServerMessageOf<T>;
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.socket.close();
  }

  /** Drops the TCP connection without a close handshake. */
  terminate(): void {
    this.socket.terminate();
  }
}
