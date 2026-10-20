import {
  Channel as ChannelPb,
  Config,
  fromBinary,
  Mesh,
  Portnums,
  Telemetry,
  type FromRadio,
} from "@meshterm/protocol";
import {
  BROADCAST_NUM,
  type Channel,
  type DeviceMetrics,
  type EnvironmentMetrics,
  type NodePosition,
} from "@meshterm/shared";
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

const MAX_CHANNEL_INDEX = 7;

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
      return decoded(nodeInfoEvents(v.value, ctx));
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
              // Persistence re-classifies against our node number (see classifyDm).
              peer: isBroadcast ? null : packet.from,
              // PKI DMs aren't decrypted with a channel key; the field may hold anything.
              channelIndex: packet.channel <= MAX_CHANNEL_INDEX ? packet.channel : 0,
              text: new TextDecoder().decode(data.payload),
              rxTime: packetTime(packet, ctx.now),
              direction: "in",
              status: null,
              ...signal(packet),
              pkiEncrypted: packet.pkiEncrypted,
              viaMqtt: packet.viaMqtt,
              replyId: data.replyId === 0 ? null : data.replyId,
              emoji: data.emoji !== 0,
              hopStart: packet.hopStart === 0 ? null : packet.hopStart,
              hopLimit: packet.hopStart === 0 ? null : packet.hopLimit,
              errorReason: null,
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
    case Portnums.PortNum.TELEMETRY_APP: {
      const telemetry = fromBinary(Telemetry.TelemetrySchema, data.payload);
      const base = {
        connectionId: ctx.connectionId,
        nodeNum: packet.from,
        time: telemetry.time > 0 ? telemetry.time * 1000 : packetTime(packet, ctx.now),
      };
      const t = telemetry.variant;
      if (t.case === "deviceMetrics") {
        return decoded([
          {
            type: "radio.telemetry",
            payload: { report: { ...base, kind: "device", device: deviceMetrics(t.value) } },
          },
        ]);
      }
      if (t.case === "environmentMetrics") {
        return decoded([
          {
            type: "radio.telemetry",
            payload: {
              report: { ...base, kind: "environment", environment: environmentMetrics(t.value) },
            },
          },
        ]);
      }
      return ignore(`telemetry ${t.case ?? "empty"}`);
    }
    case Portnums.PortNum.POSITION_APP: {
      const position = toPosition(
        fromBinary(Mesh.PositionSchema, data.payload),
        ctx.connectionId,
        packet.from,
        packetTime(packet, ctx.now),
      );
      if (!position) return ignore("position without a fix");
      return decoded([{ type: "radio.position", payload: { position } }]);
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
    case Portnums.PortNum.NEIGHBORINFO_APP: {
      const info = fromBinary(Mesh.NeighborInfoSchema, data.payload);
      return decoded([
        {
          type: "radio.neighbors",
          payload: {
            connectionId: ctx.connectionId,
            reporter: packet.from,
            time: ctx.now,
            neighbors: info.neighbors
              .filter((n) => n.nodeId !== 0 && n.nodeId !== packet.from)
              .map((n) => ({ num: n.nodeId, snr: round(n.snr, 2) })),
          },
        },
      ]);
    }
    default:
      return ignore(`port ${enumName(Portnums.PortNum, data.portnum) ?? String(data.portnum)}`);
  }
}

/** A packet's port name for statistics; `ENCRYPTED` when it couldn't be decoded. */
export function packetPort(packet: Mesh.MeshPacket): string {
  if (packet.payloadVariant.case !== "decoded") return "ENCRYPTED";
  const port = packet.payloadVariant.value.portnum;
  return enumName(Portnums.PortNum, port) ?? `PORT_${port}`;
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
  const { rxSnr, rxRssi } = signal(packet);
  if (rxSnr !== null) update.snr = rxSnr;
  if (rxRssi !== null) update.rssi = rxRssi;
  const hops = hopsAway(packet);
  if (hops !== null) update.hopsAway = hops;
  return { type: "radio.node", payload: { connectionId: ctx.connectionId, update } };
}

/**
 * A NodeDB entry (handshake): the node itself, plus its last known position and
 * device metrics when present, so a fresh start has data before any packet arrives.
 */
function nodeInfoEvents(info: Mesh.NodeInfo, ctx: DecodeContext): RadioEvent[] {
  const events: RadioEvent[] = [
    {
      type: "radio.node",
      payload: { connectionId: ctx.connectionId, update: nodeInfoUpdate(info) },
    },
  ];
  const heardAt = info.lastHeard > 0 ? info.lastHeard * 1000 : ctx.now;
  const position = info.position
    ? toPosition(info.position, ctx.connectionId, info.num, heardAt)
    : null;
  if (position) events.push({ type: "radio.position", payload: { position } });
  if (info.deviceMetrics) {
    events.push({
      type: "radio.telemetry",
      payload: {
        report: {
          connectionId: ctx.connectionId,
          nodeNum: info.num,
          time: heardAt,
          kind: "device",
          device: deviceMetrics(info.deviceMetrics),
        },
      },
    });
  }
  return events;
}

/** Null when the position has no fix (missing or 0,0 coordinates). */
function toPosition(
  p: Mesh.Position,
  connectionId: number,
  nodeNum: number,
  fallbackTime: number,
): NodePosition | null {
  const { latitudeI, longitudeI } = p;
  if (latitudeI === undefined || longitudeI === undefined) return null;
  if (latitudeI === 0 && longitudeI === 0) return null;
  return {
    connectionId,
    nodeNum,
    // Divide (not multiply by 1e-7) so values like 47.59 come out exact.
    lat: latitudeI / 1e7,
    lon: longitudeI / 1e7,
    altitude: p.altitude ?? null,
    // 0 means "not set" (full precision); 32 is full precision.
    precisionBits: p.precisionBits > 0 ? p.precisionBits : null,
    time: p.time > 0 ? p.time * 1000 : fallbackTime,
  };
}

/** Protobuf floats are float32; keep sensible decimals. */
const round = (x: number | undefined, places: number): number | null =>
  x === undefined ? null : Math.round(x * 10 ** places) / 10 ** places;

function deviceMetrics(m: Telemetry.DeviceMetrics): DeviceMetrics {
  return {
    batteryLevel: m.batteryLevel ?? null,
    voltage: round(m.voltage, 3),
    channelUtil: round(m.channelUtilization, 2),
    airUtilTx: round(m.airUtilTx, 2),
    uptimeSeconds: m.uptimeSeconds ?? null,
  };
}

function environmentMetrics(m: Telemetry.EnvironmentMetrics): EnvironmentMetrics {
  return {
    temperature: round(m.temperature, 2),
    humidity: round(m.relativeHumidity, 2),
    pressure: round(m.barometricPressure, 2),
  };
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
