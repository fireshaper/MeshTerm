import { z } from "zod";
import {
  Channel,
  ChannelIndex,
  ConnectionId,
  ConnectionState,
  MeshNode,
  Message,
  MessageStatus,
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
});

export const MessageStatusMessage = z.object({
  type: z.literal("message.status"),
  connectionId: ConnectionId,
  messageId: z.uuid(),
  status: MessageStatus,
});

export const ErrorMessage = z.object({
  type: z.literal("error"),
  code: z.string().min(1),
  message: z.string(),
});

export const ServerMessage = z.discriminatedUnion("type", [
  SnapshotMessage,
  ConnectionStateMessage,
  NodeUpsertMessage,
  MessageNewMessage,
  MessageStatusMessage,
  ErrorMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type ServerMessageType = ServerMessage["type"];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;
