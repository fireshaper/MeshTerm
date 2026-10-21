import type { InboundReport } from "@meshterm/fake-node";
import type { Page } from "@playwright/test";
import { CONTROL_PORT } from "./ports.js";

export const RIDGE = 0x0badcafe;
export const TRAIL = 0x1a2b3c4d;
export const ME = 0xa1b2c3d4;

export type InboundAudit = InboundReport;

/** Extra packet fields for an injected text (see FakeNode `InjectTextOptions`). */
export interface TextOptions {
  pkiEncrypted?: boolean;
  viaMqtt?: boolean;
  replyId?: number;
  emoji?: boolean;
  packetId?: number;
  hopsAway?: number;
}

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
    injectText: (
      from: number,
      target: { channel: number } | { to: number },
      text: string,
      options: TextOptions = {},
    ) => call<{ packetId: number }>("POST", "/inject-text", { from, target, text, options }),
    injectTelemetry: (
      from: number,
      report: { device: Record<string, number> } | { environment: Record<string, number> },
    ) => call<{ packetId: number }>("POST", "/inject-telemetry", { from, ...report }),
    injectNeighbors: (from: number, neighbors: { nodeId: number; snr: number }[]) =>
      call<{ packetId: number }>("POST", "/inject-neighbors", { from, neighbors }),
    injectPosition: (from: number, lat: number, lon: number) =>
      call<{ packetId: number }>("POST", "/inject-position", { from, lat, lon }),
    setAckMode: (mode: "ack" | "nak" | "silent", reason?: string) =>
      call("POST", "/ack-mode", { mode, reason }),
    adminOptions: (options: { rebootOnCommitMs?: number; clampTxPowerTo?: number | null }) =>
      call("POST", "/admin-options", options),
    adminLog: () => call<{ log: string[] }>("GET", "/admin-log"),
    clearInbound: () => call("POST", "/clear-inbound"),
    inbound: () => call<InboundAudit>("GET", "/inbound"),
  };
}

/** The FakeNode behind the shared e2e server (serve.ts). */
export const fakeNode = controlClient(CONTROL_PORT);

/**
 * Resolves once the page's live socket has its first snapshot, i.e. it is subscribed
 * and will receive events. Call before navigating. Waiting for the status pill isn't
 * enough: it can show "connected" from REST data before the socket subscribes, and an
 * event injected in that gap never reaches the page.
 */
export function socketSubscribed(page: Page): Promise<void> {
  return new Promise<void>((resolve) => {
    page.on("websocket", (ws) => {
      ws.on("framereceived", ({ payload }) => {
        if (String(payload).includes('"type":"snapshot"')) resolve();
      });
    });
  });
}
