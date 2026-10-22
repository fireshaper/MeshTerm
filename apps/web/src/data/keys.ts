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
  me: ["me"] as const,
  configSchema: ["configSchema"] as const,
  /** The signed-in user's notification settings (CR-003). */
  notificationPrefs: ["notificationPrefs"] as const,
  deviceConfig: (connectionId: number) => ["deviceConfig", connectionId] as const,
  /** The latest `config.apply` status seen for a connection (from WS or the apply response). */
  configApply: (connectionId: number) => ["configApply", connectionId] as const,
  users: ["users"] as const,
  audit: ["audit"] as const,
  nodes: (connectionId: number) => ["nodes", connectionId] as const,
  channels: (connectionId: number) => ["channels", connectionId] as const,
  dashboard: (connectionId: number) => ["dashboard", connectionId] as const,
  activity: (connectionId: number) => ["activity", connectionId] as const,
  topology: (connectionId: number) => ["topology", connectionId] as const,
  mapNodes: (connectionId: number) => ["mapNodes", connectionId] as const,
  conversations: (connectionId: number) => ["conversations", connectionId] as const,
  /** Prefix of every node detail of a connection. */
  allNodeDetails: (connectionId: number) => ["nodeDetail", connectionId] as const,
  nodeDetail: (connectionId: number, num: number) => ["nodeDetail", connectionId, num] as const,
  /** Telemetry series of one node and kind; `range` is a preset name or `custom:<from>-<to>`. */
  series: (connectionId: number, num: number, kind: string, range: string) =>
    ["series", connectionId, num, kind, range] as const,
  /** Prefix: every cached series of one node and kind (live updates patch them). */
  seriesOf: (connectionId: number, num: number, kind: string) =>
    ["series", connectionId, num, kind] as const,
  signal: (connectionId: number, num: number, range: string) =>
    ["signal", connectionId, num, range] as const,
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
