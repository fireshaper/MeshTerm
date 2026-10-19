import type { Channel, MeshNode, Message, ServerMessageOf } from "@meshterm/shared";
import { EventHub } from "./hub.js";

type Payload<T> = Omit<T, "type">;

/** Fields a packet or node record told us about one node; absent fields are unknown. */
export type NodeUpdate = { num: number } & Partial<Omit<MeshNode, "connectionId" | "num" | "id">>;

/** What the decoder makes of a `FromRadio`, before anything is stored. */
export interface RadioEvents {
  "radio.myInfo": { connectionId: number; myNodeNum: number };
  "radio.node": { connectionId: number; update: NodeUpdate };
  "radio.channel": { channel: Channel };
  /** An inbound text message, not yet deduplicated. */
  "radio.text": { message: Message };
  /** A routing reply to one of our packets: `acked`, or `failed` with the error name. */
  "radio.routing": {
    connectionId: number;
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
  /** Not in the WS protocol yet; snapshots carry channels. */
  "channel.upsert": { channel: Channel };
}

export type HubEvents = RadioEvents & PublicEvents;
export type RadioEvent = {
  [K in keyof RadioEvents]: { type: K; payload: RadioEvents[K] };
}[keyof RadioEvents];

export class Hub extends EventHub<HubEvents> {}
