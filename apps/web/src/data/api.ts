import { CSRF_HEADER } from "@meshterm/shared";
import type {
  ActivityPage,
  ApplyBody,
  ApplyStatusDTO,
  ChannelUrlDTO,
  ParsedChannelUrlDTO,
  ConfigSchemaDTO,
  DeviceConfigDTO,
  AuditPage,
  MeDTO,
  Role,
  UserDTO,
  Channel,
  ConversationsDTO,
  ConnectionState,
  DashboardDTO,
  HistoryWindow,
  MapNodesDTO,
  MeshNode,
  Message,
  NodeDetailDTO,
  NodeHistory,
  SeriesDTO,
  SignalDTO,
  TelemetryKind,
  TopologyDTO,
  TrafficDTO,
  TrafficWindow,
} from "@meshterm/shared";
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

/** The session's CSRF token (from `/api/auth/me`), sent on every non-GET request. */
let csrfToken = "";
export function setCsrfToken(token: string): void {
  csrfToken = token;
}

/** Called when an API request says the session is gone (the gate shows the login). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const res = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" && csrfToken ? { [CSRF_HEADER]: csrfToken } : {}),
    },
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized?.();
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const { error, message } = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, error ?? "error", message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  me: () => request<MeDTO>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ ok: true }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  setup: (username: string, password: string) =>
    request<{ ok: true }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify({ current, next }),
    }),
  users: () => request<UserDTO[]>("/api/users"),
  createUser: (body: { username: string; password: string; role: Role }) =>
    request<UserDTO>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: number, body: { role?: Role; password?: string }) =>
    request<UserDTO>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id: number) => request<{ ok: true }>(`/api/users/${id}`, { method: "DELETE" }),
  audit: (before?: number | null) =>
    request<AuditPage>(`/api/audit?limit=50${before ? `&before=${before}` : ""}`),

  connections: () => request<ConnectionView[]>("/api/connections"),
  nodes: (connectionId: number) => request<MeshNode[]>(`/api/connections/${connectionId}/nodes`),
  channels: (connectionId: number) =>
    request<Channel[]>(`/api/connections/${connectionId}/channels`),

  dashboard: (connectionId: number) =>
    request<DashboardDTO>(`/api/connections/${connectionId}/dashboard`),

  /** Activity feed, newest first; `before` pages back. */
  events: (connectionId: number, before?: number | null) =>
    request<ActivityPage>(
      `/api/connections/${connectionId}/events?limit=50${before ? `&before=${before}` : ""}`,
    ),

  traffic: (connectionId: number, window: TrafficWindow) =>
    request<TrafficDTO>(`/api/connections/${connectionId}/traffic?window=${window}`),

  nodeHistory: (connectionId: number, num: number, window: HistoryWindow) =>
    request<NodeHistory>(`/api/connections/${connectionId}/nodes/${num}/history?window=${window}`),

  nodeDetail: (connectionId: number, num: number) =>
    request<NodeDetailDTO>(`/api/connections/${connectionId}/nodes/${num}`),

  /** Telemetry series (CR-001 §6.2); `signal` lets a range change cancel the old request. */
  telemetrySeries: (
    connectionId: number,
    num: number,
    kind: TelemetryKind,
    from: number,
    to: number,
    signal?: AbortSignal,
  ) =>
    request<SeriesDTO>(
      `/api/connections/${connectionId}/nodes/${num}/telemetry?kind=${kind}&from=${from}&to=${to}`,
      signal ? { signal } : undefined,
    ),

  signalSeries: (
    connectionId: number,
    num: number,
    from: number,
    to: number,
    signal?: AbortSignal,
  ) =>
    request<SignalDTO>(
      `/api/connections/${connectionId}/nodes/${num}/signal?from=${from}&to=${to}`,
      signal ? { signal } : undefined,
    ),

  /** Download link for raw telemetry (not fetched by the app). */
  telemetryCsvUrl: (connectionId: number, num: number, from: number, to: number) =>
    `/api/connections/${connectionId}/nodes/${num}/telemetry.csv?from=${from}&to=${to}`,

  configSchema: () => request<ConfigSchemaDTO>("/api/config/schema"),
  deviceConfig: (connectionId: number) =>
    request<DeviceConfigDTO>(`/api/connections/${connectionId}/config`),
  applyConfig: (connectionId: number, body: ApplyBody) =>
    request<ApplyStatusDTO>(`/api/connections/${connectionId}/config/apply`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  applyStatus: (connectionId: number, applyId: string) =>
    request<ApplyStatusDTO>(`/api/connections/${connectionId}/config/apply/${applyId}`),
  randomPsk: (bits: 128 | 256) => request<{ psk: string }>(`/api/config/random-psk?bits=${bits}`),
  channelUrl: (connectionId: number, indexes: number[], lora: boolean) =>
    request<ChannelUrlDTO>(
      `/api/connections/${connectionId}/channels/url?indexes=${indexes.join(",")}&lora=${lora}`,
    ),
  parseChannelUrl: (connectionId: number, url: string) =>
    request<ParsedChannelUrlDTO>(`/api/connections/${connectionId}/channels/url/parse`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  refreshConfig: (connectionId: number) =>
    request<DeviceConfigDTO>(`/api/connections/${connectionId}/config/refresh`, { method: "POST" }),

  conversations: (connectionId: number) =>
    request<ConversationsDTO>(`/api/connections/${connectionId}/conversations`),

  mapNodes: (connectionId: number) =>
    request<MapNodesDTO>(`/api/connections/${connectionId}/map/nodes`),

  topology: (connectionId: number) =>
    request<TopologyDTO>(`/api/connections/${connectionId}/topology`),

  /** Drops and re-establishes the link to the node (handshake only). */
  reconnect: (connectionId: number) =>
    request<{ state: ConnectionState }>(`/api/connections/${connectionId}/reconnect`, {
      method: "POST",
    }),

  /** Local favorite flag; the server answers with the node and a `node.upsert`. */
  setFavorite: (connectionId: number, num: number, favorite: boolean) =>
    request<{ node: MeshNode }>(`/api/connections/${connectionId}/nodes/${num}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ favorite }),
    }),

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
