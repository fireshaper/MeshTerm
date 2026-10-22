import { z } from "zod";
import { NotifyLevel } from "./notifications.js";
import {
  ChannelEncryption,
  ChannelIndex,
  ChannelRole,
  Direction,
  EpochMs,
  MessageStatus,
  Uint32,
  type Channel,
} from "./domain.js";

export const ConversationKind = z.enum(["channel", "dm"]);
export type ConversationKind = z.infer<typeof ConversationKind>;

/** Read state and list preferences of a conversation (shared by every user of the node). */
export const ConversationState = z.object({
  /** Messages received up to this time (epoch ms) have been read. */
  lastReadRxTime: z.number().int().nonnegative(),
  muted: z.boolean(),
  favorite: z.boolean(),
  /** CR-003; the kind's default when never set (channels `mentions`, DMs `dm-default`). */
  notifyLevel: NotifyLevel,
});
export type ConversationState = z.infer<typeof ConversationState>;

/** The newest message of a conversation, for its row in the list. */
export const MessagePreview = z.object({
  id: z.uuid(),
  text: z.string(),
  rxTime: EpochMs,
  direction: Direction,
  /** A reaction: `text` is the emoji. */
  emoji: z.boolean(),
  pkiEncrypted: z.boolean(),
  status: MessageStatus.nullable(),
});
export type MessagePreview = z.infer<typeof MessagePreview>;

export const ChannelConversation = z.object({
  index: ChannelIndex,
  /** Display name: the channel name, else the modem preset (primary), else "Channel N". */
  name: z.string(),
  role: ChannelRole,
  encryption: ChannelEncryption.nullable(),
  lastMessage: MessagePreview.nullable(),
  /** Incoming messages after the read mark (reactions and ignored nodes don't count). */
  unread: z.number().int().nonnegative(),
  state: ConversationState,
});
export type ChannelConversation = z.infer<typeof ChannelConversation>;

export const DmConversation = z.object({
  /** The other node's number. */
  peer: Uint32,
  lastMessage: MessagePreview,
  unread: z.number().int().nonnegative(),
  state: ConversationState,
  /** The peer is an ignored node: listed only with "Show ignored". */
  ignored: z.boolean(),
});
export type DmConversation = z.infer<typeof DmConversation>;

/** `GET /api/connections/:id/conversations`: everything the conversation list shows. */
export const ConversationsDTO = z.object({
  /** Enabled channels in index order. */
  channels: z.array(ChannelConversation),
  /** One per peer with at least one message, newest conversation first. */
  dms: z.array(DmConversation),
});
export type ConversationsDTO = z.infer<typeof ConversationsDTO>;

/**
 * What kind of key a PSK is, so the PSK itself never has to leave the server: empty
 * (or the 1-byte 0) is no encryption, other 1-byte values pick a well-known default
 * key, 16 or 32 bytes are a custom key.
 */
export function pskKind(psk: Uint8Array | undefined): ChannelEncryption {
  if (!psk || psk.length === 0) return "none";
  if (psk.length === 1) return psk[0] === 0 ? "none" : "default";
  return "custom";
}

/** `LONG_FAST` → `LongFast`, as the Meshtastic apps name the default primary channel. */
export function modemPresetName(preset: string): string {
  return preset
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** What a channel is called in the UI; the primary channel's name is often empty. */
export function channelDisplayName(
  channel: Pick<Channel, "index" | "name" | "role">,
  modemPreset: string | null,
): string {
  if (channel.name) return channel.name;
  if (channel.role === "PRIMARY") return modemPreset ? modemPresetName(modemPreset) : "Primary";
  return `Channel ${channel.index}`;
}
