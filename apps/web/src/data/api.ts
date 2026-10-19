import type { Channel, ConnectionState, MeshNode, Message } from "@meshterm/shared";
import type { Conversation } from "./keys.js";

/** `GET /api/connections` row. */
export interface ConnectionView {
  id: number;
  name: string;
  host: string;
  port: number;
  transport: string;
  enabled: boolean;
  state: ConnectionState | null;
  myNodeNum: number | null;
}

/** A non-2xx response; `code` is the server's machine-readable error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const { error, message } = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, error ?? "error", message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  connections: () => request<ConnectionView[]>("/api/connections"),
  nodes: (connectionId: number) => request<MeshNode[]>(`/api/connections/${connectionId}/nodes`),
  channels: (connectionId: number) =>
    request<Channel[]>(`/api/connections/${connectionId}/channels`),

  /** One page of a conversation, newest first. */
  messages: (
    connectionId: number,
    conversation: Conversation,
    options: { before?: string | null; limit?: number } = {},
  ) => {
    const params = new URLSearchParams(
      "channel" in conversation
        ? { channel: String(conversation.channel) }
        : { peer: String(conversation.peer) },
    );
    if (options.before) params.set("before", options.before);
    params.set("limit", String(options.limit ?? 50));
    return request<{ messages: Message[]; nextCursor: string | null }>(
      `/api/connections/${connectionId}/messages?${params.toString()}`,
    );
  },

  send: (connectionId: number, text: string, conversation: Conversation) =>
    request<{ message: Message }>(`/api/connections/${connectionId}/messages`, {
      method: "POST",
      body: JSON.stringify(
        "channel" in conversation
          ? { text, channel: conversation.channel }
          : { text, to: conversation.peer },
      ),
    }),
};
