import {
  Channel as ChannelPb,
  Config,
  fromBinary,
  Mesh,
  Portnums,
  type FromRadio,
} from "@meshterm/protocol";
import { BROADCAST_NUM, type Channel } from "@meshterm/shared";
import type { NodeUpdate, RadioEvent } from "./events.js";

export interface DecodeContext {
  connectionId: number;
  /** Epoch ms; used when a packet has no `rx_time`. */
  now: number;
  /** Id for a new message row (a UUID in production). */
  newId: () => string;
}

export type DecodeResult =
  { events: RadioEvent[]; ignored: null } | { events: []; ignored: string };

const decoded = (events: RadioEvent[]): DecodeResult => ({ events, ignored: null });
const ignore = (why: string): DecodeResult => ({ events: [], ignored: why });

/**
 * Turns one `FromRadio` into zero or more radio events. Pure apart from `ctx`.
 * `ignored` says why nothing came out, so the caller can log it at debug level.
 */
export function decodeFromRadio(message: FromRadio, ctx: DecodeContext): DecodeResult {
  const v = message.payloadVariant;
  switch (v.case) {
    case "myInfo":
      return decoded([
        {
          type: "radio.myInfo",
          payload: { connectionId: ctx.connectionId, myNodeNum: v.value.myNodeNum },
        },
      ]);
    case "nodeInfo":
      return decoded([
        {
          type: "radio.node",
          payload: { connectionId: ctx.connectionId, update: nodeInfoUpdate(v.value) },
        },
      ]);
    case "channel":
      return decoded([
        { type: "radio.channel", payload: { channel: toChannel(v.value, ctx.connectionId) } },
      ]);
    case "packet":
      return decodePacket(v.value, ctx);
    default:
      return ignore(`FromRadio ${v.case ?? "empty"}`);
  }
}

function decodePacket(packet: Mesh.MeshPacket, ctx: DecodeContext): DecodeResult {
  if (packet.payloadVariant.case !== "decoded") return ignore("encrypted packet");
  const data = packet.payloadVariant.value;
  switch (data.portnum) {
    case Portnums.PortNum.TEXT_MESSAGE_APP: {
      const isBroadcast = packet.to === BROADCAST_NUM;
      return decoded([
        {
          type: "radio.text",
          payload: {
            message: {
              id: ctx.newId(),
              connectionId: ctx.connectionId,
              packetId: packet.id,
              fromNum: packet.from,
              toNum: packet.to,
              peer: isBroadcast ? null : packet.from,
              channelIndex: packet.channel,
              text: new TextDecoder().decode(data.payload),
              rxTime: packetTime(packet, ctx.now),
              direction: "in",
              status: null,
              ...signal(packet),
            },
          },
        },
      ]);
    }
    case Portnums.PortNum.NODEINFO_APP: {
      const user = fromBinary(Mesh.UserSchema, data.payload);
      return decoded([
        {
          type: "radio.node",
          payload: {
            connectionId: ctx.connectionId,
            update: { num: packet.from, ...userFields(user) },
          },
        },
      ]);
    }
    case Portnums.PortNum.ROUTING_APP: {
      if (data.requestId === 0) return ignore("routing packet without request id");
      const routing = fromBinary(Mesh.RoutingSchema, data.payload);
      if (routing.variant.case !== "errorReason")
        return ignore(`routing ${routing.variant.case ?? "empty"}`);
      const reason = routing.variant.value;
      return decoded([
        {
          type: "radio.routing",
          payload: {
            connectionId: ctx.connectionId,
            requestId: data.requestId,
            status: reason === Mesh.Routing_Error.NONE ? "acked" : "failed",
            error:
              reason === Mesh.Routing_Error.NONE
                ? null
                : (enumName(Mesh.Routing_Error, reason) ?? String(reason)),
          },
        },
      ]);
    }
    default:
      return ignore(`port ${enumName(Portnums.PortNum, data.portnum) ?? String(data.portnum)}`);
  }
}

/**
 * Any packet from a node means we just heard it: last heard, and signal/hops when
 * the packet carries them. Separate from {@link decodeFromRadio} so it applies to
 * every packet, including ports and encrypted payloads the decoder ignores.
 */
export function nodeHeard(message: FromRadio, ctx: DecodeContext): RadioEvent | null {
  if (message.payloadVariant.case !== "packet") return null;
  const packet = message.payloadVariant.value;
  if (packet.from === 0) return null;
  const update: NodeUpdate = { num: packet.from, lastHeard: packetTime(packet, ctx.now) };
  const { rxSnr } = signal(packet);
  if (rxSnr !== null) update.snr = rxSnr;
  const hops = hopsAway(packet);
  if (hops !== null) update.hopsAway = hops;
  return { type: "radio.node", payload: { connectionId: ctx.connectionId, update } };
}

function nodeInfoUpdate(info: Mesh.NodeInfo): NodeUpdate {
  const update: NodeUpdate = {
    num: info.num,
    lastHeard: info.lastHeard > 0 ? info.lastHeard * 1000 : null,
    isFavorite: info.isFavorite,
  };
  if (info.user) Object.assign(update, userFields(info.user));
  // NodeInfo.snr is 0 when unknown; only trust it alongside a last-heard time.
  if (info.lastHeard > 0) update.snr = info.snr;
  update.hopsAway = info.hopsAway ?? null;
  return update;
}

function userFields(user: Mesh.User): Omit<NodeUpdate, "num"> {
  return {
    longName: user.longName,
    shortName: user.shortName,
    hwModel: enumName(Mesh.HardwareModel, user.hwModel),
    role: enumName(Config.Config_DeviceConfig_Role, user.role),
  };
}

function toChannel(channel: ChannelPb.Channel, connectionId: number): Channel {
  // The PSK in channel.settings is deliberately dropped here.
  return {
    connectionId,
    index: channel.index,
    name: channel.settings?.name ?? "",
    role: (enumName(ChannelPb.Channel_Role, channel.role) ?? "DISABLED") as Channel["role"],
  };
}

/** `rx_time` is whole seconds and 0 when unset. */
function packetTime(packet: Mesh.MeshPacket, now: number): number {
  return packet.rxTime ? packet.rxTime * 1000 : now;
}

/** Both are 0 on packets that never crossed the air (e.g. from the node itself). */
function signal(packet: Mesh.MeshPacket): { rxSnr: number | null; rxRssi: number | null } {
  const rxRssi = packet.rxRssi ?? 0;
  if (packet.rxSnr === 0 && rxRssi === 0) return { rxSnr: null, rxRssi: null };
  return { rxSnr: packet.rxSnr, rxRssi: rxRssi === 0 ? null : rxRssi };
}

function hopsAway(packet: Mesh.MeshPacket): number | null {
  if (packet.hopStart === 0 || packet.hopLimit > packet.hopStart) return null;
  return packet.hopStart - packet.hopLimit;
}

/** Name of an enum value, or null for a value this protobufs version doesn't know (newer firmware). */
function enumName(enumObject: object, value: number): string | null {
  const name: unknown = (enumObject as Record<number, unknown>)[value];
  return typeof name === "string" ? name : null;
}
