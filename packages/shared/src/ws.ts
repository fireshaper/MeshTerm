import { z } from "zod";
import { ApplyStatusDTO } from "./device-config.js";
import { ActivityEvent } from "./activity.js";
import { ConversationKind, ConversationState } from "./conversations.js";
import { NotificationPrefsDTO, NotifyHint } from "./notifications.js";
import {
  Channel,
  ChannelIndex,
  ConnectionId,
  ConnectionState,
  MeshNode,
  Message,
  MessageStatus,
  NodePosition,
  TelemetryKind,
  TelemetryReport,
  Uint32,
} from "./domain.js";

// ── Client → server ────────────────────────────────────────────────────────

export const SubscribeMessage = z.object({
  type: z.literal("subscribe"),
  connectionId: ConnectionId,
});

export const ClientMessage = z.discriminatedUnion("type", [SubscribeMessage]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ── Server → client ────────────────────────────────────────────────────────

export const SnapshotMessage = z.object({
  type: z.literal("snapshot"),
  connectionId: ConnectionId,
  state: ConnectionState,
  myNodeNum: Uint32.nullable(),
  nodes: z.array(MeshNode),
  channels: z.array(Channel),
  /** Most recent messages per channel, oldest first. */
  channelMessages: z.array(z.object({ channelIndex: ChannelIndex, messages: z.array(Message) })),
  /** Most recent messages per DM peer, oldest first. */
  dmMessages: z.array(z.object({ peer: Uint32, messages: z.array(Message) })),
});

export const ConnectionStateMessage = z.object({
  type: z.literal("connection.state"),
  connectionId: ConnectionId,
  state: ConnectionState,
  previous: ConnectionState.nullable(),
  reason: z.string().nullable(),
});

export const NodeUpsertMessage = z.object({
  type: z.literal("node.upsert"),
  node: MeshNode,
});

export const MessageNewMessage = z.object({
  type: z.literal("message.new"),
  message: Message,
  /** For this socket's user (CR-003 §11); absent for our own messages. */
  notify: NotifyHint.optional(),
});

/** Once per reconnect, when the backlog window closes (CR-003 §4.3). */
export const NotificationsBacklogMessage = z.object({
  type: z.literal("notifications.backlog"),
  connectionId: ConnectionId,
  count: z.number().int().nonnegative(),
  dmCount: z.number().int().nonnegative(),
  conversations: z.array(
    z.object({
      kind: z.enum(["channel", "dm"]),
      key: z.number().int().nonnegative(),
      count: z.number().int().positive(),
    }),
  ),
});

/** This user changed their notification settings (DND syncs across their browsers). */
export const NotificationPrefsUpdatedMessage = z.object({
  type: z.literal("notification-prefs.updated"),
  prefs: NotificationPrefsDTO,
});

export const MessageStatusMessage = z.object({
  type: z.literal("message.status"),
  connectionId: ConnectionId,
  messageId: z.uuid(),
  status: MessageStatus,
  /** Why it failed (`Routing.Error` name); null otherwise or on timeout. */
  errorReason: z.string().nullable(),
  /** The message was relayed by the mesh, without the recipient's ACK (yet). */
  relayed: z.boolean(),
});

export const TelemetryNewMessage = z.object({
  type: z.literal("telemetry.new"),
  telemetry: TelemetryReport,
});

export const PositionNewMessage = z.object({
  type: z.literal("position.new"),
  position: NodePosition,
});

export const ErrorMessage = z.object({
  type: z.literal("error"),
  code: z.string().min(1),
  message: z.string(),
});

/** The node's config changed (handshake, refresh, or another client): editors re-check. */
export const ConfigUpdatedMessage = z.object({
  type: z.literal("config.updated"),
  connectionId: ConnectionId,
  version: z.string(),
});

/** An apply moved to another phase; other browsers lock their editors while it runs. */
export const ConfigApplyMessage = z.object({
  type: z.literal("config.apply"),
  status: ApplyStatusDTO,
});

export const ActivityNewMessage = z.object({
  type: z.literal("activity.new"),
  activity: ActivityEvent,
});

/** A conversation was read (in any browser): badges and counts clear everywhere. */
export const ConversationReadMessage = z.object({
  type: z.literal("conversation.read"),
  connectionId: ConnectionId,
  kind: ConversationKind,
  /** Channel index or DM peer number. */
  key: z.number().int().nonnegative(),
  lastReadRxTime: z.number().int().nonnegative(),
});

/** Mute/favorite changed, or a DM was deleted (`deletedBefore` moved). */
export const ConversationUpdatedMessage = z.object({
  type: z.literal("conversation.updated"),
  connectionId: ConnectionId,
  kind: ConversationKind,
  key: z.number().int().nonnegative(),
  state: ConversationState,
  deletedBefore: z.number().int().nonnegative(),
});

/** A telemetry request to a node (CR-001 C4): sent, answered, or no answer in 60 s. */
export const TelemetryRequestMessage = z.object({
  type: z.literal("telemetry.request"),
  connectionId: ConnectionId,
  nodeNum: Uint32,
  kind: TelemetryKind,
  state: z.enum(["sent", "received", "timeout"]),
});

/**
 * A theme was added, edited or removed in /data/themes (CR-004 §4.3), to every socket.
 * `removed`: it's gone (a built-in it overrode comes back with its own hash instead).
 */
export const ThemeChangedMessage = z.object({
  type: z.literal("theme.changed"),
  id: z.string(),
  hash: z.string(),
  removed: z.boolean().optional(),
});

export const ServerMessage = z.discriminatedUnion("type", [
  SnapshotMessage,
  ConnectionStateMessage,
  NodeUpsertMessage,
  MessageNewMessage,
  MessageStatusMessage,
  TelemetryNewMessage,
  PositionNewMessage,
  ActivityNewMessage,
  ConfigUpdatedMessage,
  ConfigApplyMessage,
  ConversationReadMessage,
  ConversationUpdatedMessage,
  NotificationsBacklogMessage,
  NotificationPrefsUpdatedMessage,
  TelemetryRequestMessage,
  ThemeChangedMessage,
  ErrorMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type ServerMessageType = ServerMessage["type"];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;
