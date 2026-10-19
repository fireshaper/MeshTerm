import { z } from "zod";

/** Meshtastic node numbers and packet ids are unsigned 32-bit integers. */
export const Uint32 = z.number().int().min(0).max(0xffff_ffff);
/** Unix epoch milliseconds. All timestamps in the domain use this unit. */
export const EpochMs = z.number().int().nonnegative();
export const ChannelIndex = z.number().int().min(0).max(7);
export const ConnectionId = z.number().int().positive();

export const ConnectionState = z.enum([
  "disconnected",
  "connecting",
  "configuring",
  "connected",
  "reconnecting",
]);
export type ConnectionState = z.infer<typeof ConnectionState>;

export const Transport = z.enum(["tcp"]);
export type Transport = z.infer<typeof Transport>;

export const Connection = z.object({
  id: ConnectionId,
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  transport: Transport,
  enabled: z.boolean(),
});
export type Connection = z.infer<typeof Connection>;

export const MeshNode = z.object({
  connectionId: ConnectionId,
  num: Uint32,
  /** `!` followed by 8 lowercase hex digits, e.g. `!a1b2c3d4`. */
  id: z.string().regex(/^![0-9a-f]{8}$/),
  longName: z.string(),
  shortName: z.string(),
  /** `HardwareModel` enum name from the protobufs, e.g. `HELTEC_V3`. */
  hwModel: z.string().nullable(),
  /** `Config.DeviceConfig.Role` enum name, e.g. `CLIENT`. */
  role: z.string().nullable(),
  lastHeard: EpochMs.nullable(),
  snr: z.number().nullable(),
  hopsAway: z.number().int().nonnegative().nullable(),
  isFavorite: z.boolean(),
});
export type MeshNode = z.infer<typeof MeshNode>;

export const ChannelRole = z.enum(["DISABLED", "PRIMARY", "SECONDARY"]);
export type ChannelRole = z.infer<typeof ChannelRole>;

/** Deliberately has no PSK field: unknown keys (including `psk`) are stripped on parse. */
export const Channel = z.object({
  connectionId: ConnectionId,
  index: ChannelIndex,
  name: z.string(),
  role: ChannelRole,
});
export type Channel = z.infer<typeof Channel>;

export const MessageStatus = z.enum(["queued", "sent", "acked", "failed"]);
export type MessageStatus = z.infer<typeof MessageStatus>;

export const Direction = z.enum(["in", "out"]);
export type Direction = z.infer<typeof Direction>;

export const Message = z.object({
  id: z.uuid(),
  connectionId: ConnectionId,
  packetId: Uint32,
  fromNum: Uint32,
  toNum: Uint32,
  /** Other party of a DM (`toNum` when outgoing, `fromNum` when incoming); null for broadcasts. */
  peer: Uint32.nullable(),
  channelIndex: ChannelIndex,
  text: z.string(),
  rxTime: EpochMs,
  direction: Direction,
  /** Delivery status of outgoing messages; null for incoming. */
  status: MessageStatus.nullable(),
  rxSnr: z.number().nullable(),
  rxRssi: z.number().int().nullable(),
});
export type Message = z.infer<typeof Message>;

/** Device metrics a node reports (TELEMETRY_APP); null fields weren't reported. */
export const DeviceMetrics = z.object({
  /** 0–100 %, or above 100 when the node is on external power. */
  batteryLevel: z.number().int().nonnegative().nullable(),
  voltage: z.number().nullable(),
  /** Percent of airtime the node hears in use. */
  channelUtil: z.number().nullable(),
  /** Percent of airtime the node itself transmitted (last hour). */
  airUtilTx: z.number().nullable(),
  uptimeSeconds: z.number().int().nonnegative().nullable(),
});
export type DeviceMetrics = z.infer<typeof DeviceMetrics>;

/** Environment sensor readings (°C, % relative humidity, hPa). */
export const EnvironmentMetrics = z.object({
  temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  pressure: z.number().nullable(),
});
export type EnvironmentMetrics = z.infer<typeof EnvironmentMetrics>;

const TelemetryBase = { connectionId: ConnectionId, nodeNum: Uint32, time: EpochMs };

/** One telemetry report from one node. */
export const TelemetryReport = z.discriminatedUnion("kind", [
  z.object({ ...TelemetryBase, kind: z.literal("device"), device: DeviceMetrics }),
  z.object({ ...TelemetryBase, kind: z.literal("environment"), environment: EnvironmentMetrics }),
]);
export type TelemetryReport = z.infer<typeof TelemetryReport>;

/** A node's position. `precisionBits` < 32 means it was deliberately coarsened. */
export const NodePosition = z.object({
  connectionId: ConnectionId,
  nodeNum: Uint32,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Meters above sea level. */
  altitude: z.number().int().nullable(),
  precisionBits: z.number().int().min(0).max(32).nullable(),
  time: EpochMs,
});
export type NodePosition = z.infer<typeof NodePosition>;

/** Meshtastic broadcast address. */
export const BROADCAST_NUM = 0xffff_ffff;

/** Maximum outgoing text length in UTF-8 bytes. */
export const MAX_TEXT_BYTES = 200;

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function nodeIdFromNum(num: number): string {
  return `!${(num >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Paging cursor for message lists, `<rxTime>_<id>`: the REST `before` / `nextCursor`
 * value. Built from the oldest message a client already has.
 */
export function messageCursor(message: Pick<Message, "rxTime" | "id">): string {
  return `${message.rxTime}_${message.id}`;
}

/** Messages per conversation in a WS snapshot; a full page means older history may exist. */
export const SNAPSHOT_MESSAGES = 50;
