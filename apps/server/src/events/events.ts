import type {
  Channel,
  MeshNode,
  Message,
  NodePosition,
  ServerMessageOf,
  TelemetryReport,
} from "@meshterm/shared";
import { EventHub } from "./hub.js";

type Payload<T> = Omit<T, "type">;

/** Fields a packet or node record told us about one node; absent fields are unknown. */
export type NodeUpdate = { num: number } & Partial<
  Omit<MeshNode, "connectionId" | "num" | "id">
> & {
    /** RSSI of the packet, when heard directly. Stored, though not part of `MeshNode`. */
    rssi?: number | null;
    /** PKI public key (hex), from its User. Stored, not part of `MeshNode`. */
    publicKey?: string | null;
    /** Whether this packet came through MQTT. Stored, not part of `MeshNode`. */
    viaMqtt?: boolean;
  };

/** What the decoder makes of a `FromRadio`, before anything is stored. */
export interface RadioEvents {
  "radio.myInfo": { connectionId: number; myNodeNum: number };
  "radio.node": { connectionId: number; update: NodeUpdate };
  "radio.channel": { channel: Channel };
  /** Our node's LoRa config: its modem preset name, null when it uses custom settings. */
  /**
   * Our node's LoRa config: its modem preset name (null with custom settings) and its
   * hop limit (null when unset), which outgoing packets use.
   */
  "radio.lora": { connectionId: number; modemPreset: string | null; hopLimit: number | null };
  /** Our node's firmware version, from the handshake's DeviceMetadata. */
  "radio.metadata": { connectionId: number; firmware: string | null };
  /** An inbound text message, not yet deduplicated. */
  "radio.text": { message: Message };
  /**
   * Some packet arrived from the node (receive time, epoch ms), sent by `from` on
   * `port` (a `PortNum` name, or `ENCRYPTED` when we can't decode it).
   */
  "radio.packet": {
    connectionId: number;
    at: number;
    from: number;
    port: string;
    /** When the node received it (`rx_time`, else `at`). */
    rxTime: number;
    snr: number | null;
    rssi: number | null;
    hops: number | null;
    viaMqtt: boolean;
  };
  /** A NeighborInfo report: `reporter` heard these nodes (SNR as it measured). */
  "radio.neighbors": {
    connectionId: number;
    reporter: number;
    time: number;
    neighbors: { num: number; snr: number | null }[];
  };
  /** A telemetry report (device or environment), not yet stored. */
  "radio.telemetry": { report: TelemetryReport };
  /** A position report, not yet stored. */
  "radio.position": { position: NodePosition };
  /** A routing reply to one of our packets: `acked`, or `failed` with the error name. */
  "radio.routing": {
    connectionId: number;
    /** Who sent the reply: the DM's recipient for a real ACK, our own node for an implicit one. */
    from: number;
    requestId: number;
    status: "acked" | "failed";
    error: string | null;
  };
}

/** Events after persistence; these are what browsers get (same shapes as the WS protocol). */
export interface PublicEvents {
  "connection.state": Payload<ServerMessageOf<"connection.state">>;
  "node.upsert": Payload<ServerMessageOf<"node.upsert">>;
  "message.new": Payload<ServerMessageOf<"message.new">>;
  "message.status": Payload<ServerMessageOf<"message.status">>;
  "telemetry.new": Payload<ServerMessageOf<"telemetry.new">>;
  "position.new": Payload<ServerMessageOf<"position.new">>;
  "activity.new": Payload<ServerMessageOf<"activity.new">>;
  /** Not in the WS protocol yet; snapshots carry channels. */
  "channel.upsert": { channel: Channel };
}

export type HubEvents = RadioEvents & PublicEvents;
export type RadioEvent = {
  [K in keyof RadioEvents]: { type: K; payload: RadioEvents[K] };
}[keyof RadioEvents];

export class Hub extends EventHub<HubEvents> {}
