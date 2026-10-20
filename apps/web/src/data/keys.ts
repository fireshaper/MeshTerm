import type { Message } from "@meshterm/shared";

/** One message list: a channel's broadcasts, or the DM conversation with one node. */
export type Conversation = { channel: number } | { peer: number };

/** Cached state of one conversation. */
export interface ConversationData {
  /** Oldest first. */
  messages: Message[];
  /** `before` value for the next older page; null when there is nothing older. */
  cursor: string | null;
}

export const queryKeys = {
  connections: ["connections"] as const,
  nodes: (connectionId: number) => ["nodes", connectionId] as const,
  channels: (connectionId: number) => ["channels", connectionId] as const,
  dashboard: (connectionId: number) => ["dashboard", connectionId] as const,
  activity: (connectionId: number) => ["activity", connectionId] as const,
  traffic: (connectionId: number, window: string) => ["traffic", connectionId, window] as const,
  history: (connectionId: number, num: number, window: string) =>
    ["history", connectionId, num, window] as const,
  /** Prefix of every conversation of a connection. */
  allMessages: (connectionId: number) => ["messages", connectionId] as const,
  messages: (connectionId: number, conversation: Conversation) =>
    ["messages", connectionId, conversation] as const,
};

/** The conversation a message belongs to (`peer` is null for broadcasts). */
export function conversationOf(message: Message): Conversation {
  return message.peer === null ? { channel: message.channelIndex } : { peer: message.peer };
}
