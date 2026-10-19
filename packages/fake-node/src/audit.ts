import type { ToRadio } from "@meshterm/protocol";
import type { InboundEntry } from "./fake-node.js";

/**
 * - `handshake`: session control (`want_config_id`, `disconnect`).
 * - `heartbeat`: keep-alive.
 * - `transmit`: anything that could go out over the mesh. Every `packet` counts,
 *   even one addressed to the local node, and so does an MQTT proxy message.
 * - `other`: local-only traffic such as XModem file transfer, or an empty `ToRadio`.
 */
export type ToRadioClass = "handshake" | "heartbeat" | "transmit" | "other";

export function classifyToRadio(message: ToRadio): ToRadioClass {
  switch (message.payloadVariant.case) {
    case "wantConfigId":
    case "disconnect":
      return "handshake";
    case "heartbeat":
      return "heartbeat";
    case "packet":
    case "mqttClientProxyMessage":
      return "transmit";
    default:
      return "other";
  }
}

export interface TransmitAudit {
  counts: Record<ToRadioClass, number>;
  /** The inbound entries classed as `transmit`, oldest first. */
  transmits: InboundEntry[];
}

/** Classifies a FakeNode inbound log, e.g. `auditInbound(node.inbound).counts.transmit === 0`. */
export function auditInbound(log: readonly InboundEntry[]): TransmitAudit {
  const counts: Record<ToRadioClass, number> = {
    handshake: 0,
    heartbeat: 0,
    transmit: 0,
    other: 0,
  };
  const transmits: InboundEntry[] = [];
  for (const entry of log) {
    const cls = classifyToRadio(entry.message);
    counts[cls]++;
    if (cls === "transmit") transmits.push(entry);
  }
  return { counts, transmits };
}
