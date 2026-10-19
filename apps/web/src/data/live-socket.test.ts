// @vitest-environment node
import type { AddressInfo } from "node:net";
import type { ServerMessage } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type RawData, type WebSocket as ServerSocket } from "ws";
import { LiveSocket } from "./live-socket.js";
import type { SocketStatus } from "./store.js";

let server: WebSocketServer;
let url: string;
let sockets: ServerSocket[];
let received: unknown[];
let live: LiveSocket | null;

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return data.toString("utf8");
}

function accept(socket: ServerSocket): void {
  sockets.push(socket);
  socket.on("message", (data) => {
    received.push(JSON.parse(rawText(data)));
  });
}

async function listen(port = 0): Promise<void> {
  server = new WebSocketServer({ port, host: "127.0.0.1" });
  server.on("connection", accept);
  await new Promise((resolve) => server.once("listening", resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  sockets = [];
  received = [];
  live = null;
  await listen();
});

afterEach(async () => {
  live?.stop();
  for (const s of sockets) s.terminate();
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function start() {
  const messages: ServerMessage[] = [];
  const statuses: SocketStatus[] = [];
  const invalid: string[] = [];
  live = new LiveSocket({
    url,
    connectionId: 1,
    onMessage: (m) => {
      messages.push(m);
    },
    onStatus: (s) => {
      statuses.push(s);
    },
    onInvalid: (_raw, problem) => {
      invalid.push(problem);
    },
    backoff: { minMs: 20, maxMs: 100 },
  });
  live.start();
  return { messages, statuses, invalid };
}

const SUBSCRIBE = { type: "subscribe", connectionId: 1 };

describe("LiveSocket", () => {
  it("subscribes as soon as it opens", async () => {
    const { statuses } = start();
    await until(() => received.length === 1);
    expect(received).toEqual([SUBSCRIBE]);
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("reconnects and subscribes again after the server kills the socket", async () => {
    const { statuses } = start();
    await until(() => received.length === 1);
    sockets[0]?.terminate();
    await until(() => received.length === 2);
    expect(sockets).toHaveLength(2);
    expect(received).toEqual([SUBSCRIBE, SUBSCRIBE]);
    expect(statuses).toEqual(["connecting", "open", "closed", "connecting", "open"]);
  });

  it("drops invalid frames without throwing and keeps delivering valid ones", async () => {
    const { messages, invalid } = start();
    await until(() => received.length === 1);
    const socket = sockets[0];
    socket?.send("{not json");
    socket?.send(JSON.stringify({ type: "message.new", message: { text: "missing fields" } }));
    socket?.send(JSON.stringify({ type: "error", code: "bad_message", message: "fine" }));
    await until(() => messages.length === 1);
    expect(invalid).toEqual(["not JSON", expect.any(String)]);
    expect(messages).toEqual([{ type: "error", code: "bad_message", message: "fine" }]);
  });

  it("stops reconnecting after stop()", async () => {
    start();
    await until(() => received.length === 1);
    live?.stop();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sockets).toHaveLength(1);
  });

  it("keeps retrying while the server is unreachable, then connects", async () => {
    const port = (server.address() as AddressInfo).port;
    await new Promise((resolve) => {
      server.close(resolve);
    });
    const { statuses } = start();
    await until(() => statuses.filter((s) => s === "closed").length >= 2);
    await listen(port);
    await until(() => received.length === 1, 3_000);
    expect(received).toEqual([SUBSCRIBE]);
  });
});
