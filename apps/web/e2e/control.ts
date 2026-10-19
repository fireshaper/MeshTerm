import type { InboundReport } from "@meshterm/fake-node";
import { CONTROL_PORT } from "./ports.js";

export const RIDGE = 0x0badcafe;
export const TRAIL = 0x1a2b3c4d;
export const ME = 0xa1b2c3d4;

export type InboundAudit = InboundReport;

/** A client for a FakeNode's control API (see packages/fake-node/src/control-server.ts). */
export function controlClient(port: number) {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`control ${method} ${path} → ${res.status}`);
    return (await res.json()) as T;
  }
  return {
    reboot: (downMs: number) => call("POST", "/reboot", { downMs }),
    injectText: (from: number, target: { channel: number } | { to: number }, text: string) =>
      call<{ packetId: number }>("POST", "/inject-text", { from, target, text }),
    setAckMode: (mode: "ack" | "nak" | "silent") => call("POST", "/ack-mode", { mode }),
    clearInbound: () => call("POST", "/clear-inbound"),
    inbound: () => call<InboundAudit>("GET", "/inbound"),
  };
}

/** The FakeNode behind the shared e2e server (serve.ts). */
export const fakeNode = controlClient(CONTROL_PORT);
