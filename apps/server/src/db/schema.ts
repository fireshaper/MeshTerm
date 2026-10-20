import { TELEMETRY_KINDS } from "@meshterm/shared";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// All timestamps are Unix epoch milliseconds. Node numbers and packet ids are uint32.

export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  transport: text("transport", { enum: ["tcp"] })
    .notNull()
    .default("tcp"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** `env`: seeded from MESHTERM_NODE_HOST/PORT and kept in sync with them. `user`: added in the UI. */
  source: text("source", { enum: ["env", "user"] })
    .notNull()
    .default("user"),
  /** Our node's number, from the last handshake; NULL until the first one. */
  myNodeNum: integer("my_node_num"),
  /** When the last packet of any kind arrived from the node (no packet log yet). */
  lastPacketAt: integer("last_packet_at"),
  /** LoRa `ModemPreset` name (e.g. `LONG_FAST`) from the handshake; NULL with custom settings. */
  modemPreset: text("modem_preset"),
  /** Our node's configured LoRa hop limit (`Config.LoRaConfig.hop_limit`); outgoing packets use it. */
  hopLimit: integer("hop_limit"),
  /** Our node's firmware version (`DeviceMetadata.firmware_version`) from the handshake. */
  firmware: text("firmware"),
  createdAt: integer("created_at").notNull(),
});

export const nodes = sqliteTable(
  "nodes",
  {
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    num: integer("num").notNull(),
    longName: text("long_name").notNull().default(""),
    shortName: text("short_name").notNull().default(""),
    hwModel: text("hw_model"),
    role: text("role"),
    lastHeard: integer("last_heard"),
    snr: real("snr"),
    hopsAway: integer("hops_away"),
    isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
    /**
     * Set from MeshTerm (the dashboard star); wins over `is_favorite`, which mirrors the
     * device's NodeDB and is rewritten by every handshake. NULL = follow the device.
     */
    favoriteOverride: integer("favorite_override", { mode: "boolean" }),
    /** RSSI of the last packet heard directly from this node. */
    rssi: integer("rssi"),
    /** It announced a PKI public key, so DMs to it can be end-to-end encrypted. */
    hasPublicKey: integer("has_public_key", { mode: "boolean" }).notNull().default(false),
    /** Ignored in the device's NodeDB. */
    isIgnored: integer("is_ignored", { mode: "boolean" }).notNull().default(false),
    /** Its PKI public key (hex, 32 bytes); public by design. */
    publicKey: text("public_key"),
    /** The last packet from it came through an MQTT gateway. */
    viaMqtt: integer("via_mqtt", { mode: "boolean" }).notNull().default(false),
    /** When MeshTerm first stored this node (set by a trigger on insert). */
    firstSeen: integer("first_seen"),

    // Latest values, cached here so the dashboard reads one row per node.
    // History lives in `positions` and `telemetry`; NULL means never reported.
    lat: real("lat"),
    lon: real("lon"),
    altitude: integer("altitude"),
    precisionBits: integer("precision_bits"),
    positionTime: integer("position_time"),
    batteryLevel: integer("battery_level"),
    voltage: real("voltage"),
    channelUtil: real("channel_util"),
    airUtilTx: real("air_util_tx"),
    uptimeSeconds: integer("uptime_seconds"),
    deviceTime: integer("device_time"),
    temperature: real("temperature"),
    humidity: real("humidity"),
    pressure: real("pressure"),
    envTime: integer("env_time"),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.num] })],
);

/**
 * Signal of each packet heard from another node: SNR/RSSI (meaningful when heard
 * directly, `hops = 0`) and hops. Kept 7 days, like `packet_stats`.
 */
export const signalLog = sqliteTable(
  "signal_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    nodeNum: integer("node_num").notNull(),
    /** When the node received it (`rx_time`, else arrival), epoch ms. */
    time: integer("time").notNull(),
    snr: real("snr"),
    rssi: integer("rssi"),
    hops: integer("hops"),
    viaMqtt: integer("via_mqtt", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("signal_log_node_idx").on(t.connectionId, t.nodeNum, t.time)],
);

/** Position history. Latest per node is also on `nodes`. */
export const positions = sqliteTable(
  "positions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    nodeNum: integer("node_num").notNull(),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    altitude: integer("altitude"),
    precisionBits: integer("precision_bits"),
    /** When the position was taken (the node's clock, else when we heard it). */
    time: integer("time").notNull(),
    rxTime: integer("rx_time").notNull(),
  },
  // Unique: the handshake re-sends the last position on every reconnect.
  (t) => [uniqueIndex("positions_node_time_idx").on(t.connectionId, t.nodeNum, t.time)],
);

/** Telemetry history, one row per report. Latest per node is also on `nodes`. */
export const telemetry = sqliteTable(
  "telemetry",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    nodeNum: integer("node_num").notNull(),
    kind: text("kind", { enum: TELEMETRY_KINDS }).notNull(),
    time: integer("time").notNull(),
    // device
    batteryLevel: integer("battery_level"),
    voltage: real("voltage"),
    channelUtil: real("channel_util"),
    airUtilTx: real("air_util_tx"),
    uptimeSeconds: integer("uptime_seconds"),
    // environment
    temperature: real("temperature"),
    humidity: real("humidity"),
    pressure: real("pressure"),
    /** Every numeric field of the report (`TelemetryMetrics`, JSON); NULL on rows before 0009. */
    metrics: text("metrics", { mode: "json" }).$type<Record<string, number>>(),
  },
  (t) => [
    // Unique: the handshake re-sends the last device metrics on every reconnect.
    uniqueIndex("telemetry_node_time_idx").on(t.connectionId, t.nodeNum, t.kind, t.time),
    // Covering index for the dashboard's battery sparklines (all nodes, last 24 h).
    index("telemetry_spark_idx").on(t.connectionId, t.kind, t.time, t.nodeNum, t.batteryLevel),
  ],
);

/** Channel settings without the PSK, which is never stored. */
export const channels = sqliteTable(
  "channels",
  {
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    channelIndex: integer("channel_index").notNull(),
    name: text("name").notNull().default(""),
    role: text("role", { enum: ["DISABLED", "PRIMARY", "SECONDARY"] }).notNull(),
    /** What the PSK is (never the PSK itself): none, a well-known default key, or custom. */
    encryption: text("encryption", { enum: ["none", "default", "custom"] }),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.channelIndex] })],
);

export const messages = sqliteTable(
  "messages",
  {
    /** UUID. */
    id: text("id").primaryKey(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    packetId: integer("packet_id").notNull(),
    fromNum: integer("from_num").notNull(),
    toNum: integer("to_num").notNull(),
    /** `to_num` for outgoing DMs, `from_num` for incoming DMs, NULL for broadcasts. */
    peer: integer("peer"),
    channelIndex: integer("channel_index").notNull(),
    text: text("text").notNull(),
    rxTime: integer("rx_time").notNull(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    /** NULL for incoming messages. */
    status: text("status", { enum: ["queued", "sent", "acked", "failed"] }),
    rxSnr: real("rx_snr"),
    rxRssi: integer("rx_rssi"),
    /** The node decrypted it with its private key (a PKI DM), not a channel key. */
    pkiEncrypted: integer("pki_encrypted", { mode: "boolean" }).notNull().default(false),
    /** Reached us through an MQTT gateway. */
    viaMqtt: integer("via_mqtt", { mode: "boolean" }).notNull().default(false),
    /** Packet id of the message this one replies or reacts to. */
    replyId: integer("reply_id"),
    /** A reaction (tapback) to `reply_id`; the text is the emoji. */
    emoji: integer("emoji", { mode: "boolean" }).notNull().default(false),
    hopStart: integer("hop_start"),
    hopLimit: integer("hop_limit"),
    /** `Routing.Error` name when an outgoing message failed (NULL on timeout). */
    errorReason: text("error_reason"),
    /**
     * Outgoing DM: our node heard it relayed (an implicit ACK), but the recipient hasn't
     * confirmed it. Status stays `sent`; it doesn't fail on the ACK timeout.
     */
    relayed: integer("relayed", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("messages_channel_idx")
      .on(t.connectionId, t.channelIndex, t.rxTime)
      .where(sql`${t.peer} IS NULL`),
    index("messages_peer_idx").on(t.connectionId, t.peer, t.rxTime),
    // A rebroadcast of a packet we already have is the same (sender, packet id).
    uniqueIndex("messages_dedupe_idx").on(t.connectionId, t.fromNum, t.packetId),
    // Message counts over time (dashboard KPIs and the traffic chart).
    index("messages_time_idx").on(t.connectionId, t.rxTime, t.direction),
  ],
);

export const ACTIVITY_KINDS = [
  "message.in",
  "message.out",
  "node.new",
  "node.back",
  "power.changed",
  "connection.lost",
  "connection.restored",
] as const;

/**
 * The activity feed: notable events, a ring buffer (7 days, at most 2 000 rows per
 * connection). `value` and `detail` depend on `kind`: quiet time or downtime in ms,
 * battery level, a disconnect reason, a message preview.
 */
/**
 * Per-conversation state shared by every browser: read position, mute, favorite,
 * and a "deleted before" cut-off (deleting a DM hides its history, rows stay).
 * `key` is the channel index or the DM peer's node number.
 */
export const conversationState = sqliteTable(
  "conversation_state",
  {
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["channel", "dm"] }).notNull(),
    key: integer("key").notNull(),
    lastReadRxTime: integer("last_read_rx_time").notNull().default(0),
    muted: integer("muted", { mode: "boolean" }).notNull().default(false),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    deletedBefore: integer("deleted_before").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.kind, t.key] })],
);

export const activity = sqliteTable(
  "activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    time: integer("time").notNull(),
    kind: text("kind", { enum: ACTIVITY_KINDS }).notNull(),
    nodeNum: integer("node_num"),
    messageId: text("message_id"),
    value: real("value"),
    detail: text("detail"),
  },
  (t) => [index("activity_time_idx").on(t.connectionId, t.time)],
);

/**
 * Packets heard per minute, by sending node and port (`TEXT_MESSAGE_APP`, …, or
 * `ENCRYPTED` for packets we can't decode). Packets from my own node aren't counted.
 * Kept 7 days.
 */
export const packetStats = sqliteTable(
  "packet_stats",
  {
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    /** Start of the minute (epoch ms). */
    minute: integer("minute").notNull(),
    nodeNum: integer("node_num").notNull(),
    port: text("port").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.minute, t.nodeNum, t.port] }),
    // One node's packets over time (node details).
    index("packet_stats_node_idx").on(t.connectionId, t.nodeNum, t.minute),
  ],
);

/**
 * Links reported by nodes running the NeighborInfo module: `node_num` heard
 * `neighbor_num` with `snr`. Each report replaces that node's previous list.
 */
export const neighbors = sqliteTable(
  "neighbors",
  {
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    nodeNum: integer("node_num").notNull(),
    neighborNum: integer("neighbor_num").notNull(),
    snr: real("snr"),
    /** When the report was received. */
    time: integer("time").notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.nodeNum, t.neighborNum] })],
);

/** Key/value app settings; `value` is JSON text. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});
