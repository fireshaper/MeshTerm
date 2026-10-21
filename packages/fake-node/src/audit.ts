import { Portnums, type ToRadio } from "@meshterm/protocol";
import type { InboundEntry } from "./fake-node.js";

/**
 * - `handshake`: session control (`want_config_id`, `disconnect`).
 * - `heartbeat`: keep-alive.
 * - `transmit`: anything that could go out over the mesh. Every `packet` counts,
 *   even one addressed to the local node, and so does an MQTT proxy message.
 * - `admin`: an `ADMIN_APP` packet to the local node itself (config editor): it never
 *   leaves the node, but it changes it, so it has its own count.
 * - `other`: local-only traffic such as XModem file transfer, or an empty `ToRadio`.
 */
export type ToRadioClass = "handshake" | "heartbeat" | "transmit" | "admin" | "other";

export function classifyToRadio(message: ToRadio, localNodeNum?: number): ToRadioClass {
  const v = message.payloadVariant;
  if (
    v.case === "packet" &&
    localNodeNum !== undefined &&
    v.value.to === localNodeNum &&
    v.value.payloadVariant.case === "decoded" &&
    v.value.payloadVariant.value.portnum === Portnums.PortNum.ADMIN_APP
  ) {
    return "admin";
  }
  switch (v.case) {
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
export function auditInbound(log: readonly InboundEntry[], localNodeNum?: number): TransmitAudit {
  const counts: Record<ToRadioClass, number> = {
    handshake: 0,
    heartbeat: 0,
    transmit: 0,
    admin: 0,
    other: 0,
  };
  const transmits: InboundEntry[] = [];
  for (const entry of log) {
    const cls = classifyToRadio(entry.message, localNodeNum);
    counts[cls]++;
    if (cls === "transmit") transmits.push(entry);
  }
  return { counts, transmits };
}
