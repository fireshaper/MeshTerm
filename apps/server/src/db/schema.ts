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
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.num] })],
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
  },
  (t) => [
    index("messages_channel_idx").on(t.connectionId, t.channelIndex, t.rxTime),
    index("messages_peer_idx").on(t.connectionId, t.peer, t.rxTime),
    // A rebroadcast of a packet we already have is the same (sender, packet id).
    uniqueIndex("messages_dedupe_idx").on(t.connectionId, t.fromNum, t.packetId),
  ],
);

/** Key/value app settings; `value` is JSON text. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});
