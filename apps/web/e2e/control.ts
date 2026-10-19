import { CONTROL_PORT } from "./ports.js";

/** Drives the FakeNode behind the app under test (see serve.ts). */
async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${CONTROL_PORT}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`control ${method} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const RIDGE = 0x0badcafe;
export const ME = 0xa1b2c3d4;

export interface InboundAudit {
  counts: { handshake: number; heartbeat: number; transmit: number; other: number };
  transmits: { to: number; channel: number; portnum: number; text: string | null }[];
}

export const fakeNode = {
  reboot: (downMs: number) => call("POST", "/reboot", { downMs }),
  injectText: (from: number, target: { channel: number } | { to: number }, text: string) =>
    call<{ packetId: number }>("POST", "/inject-text", { from, target, text }),
  setAckMode: (mode: "ack" | "nak" | "silent") => call("POST", "/ack-mode", { mode }),
  clearInbound: () => call("POST", "/clear-inbound"),
  inbound: () => call<InboundAudit>("GET", "/inbound"),
};
