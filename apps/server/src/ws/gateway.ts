import { ClientMessage, type Message, type ServerMessage } from "@meshterm/shared";
import WebSocket from "ws";
import type { NodeConnection } from "../connection/node-connection.js";
import type { Db } from "../db/database.js";
import { getConnection, getMyNodeNum, getNode } from "../db/repositories.js";
import { loadPrefs, notifyHint, type MessageContext } from "../messaging/notify.js";
import { getState, publicState } from "../messaging/read-state.js";
import type { AnyEvent } from "../events/hub.js";
import type { Hub, HubEvents } from "../events/events.js";
import { silentLogger, type Logger } from "../logger.js";
import { buildSnapshot } from "./snapshot.js";

/**
 * Browser sockets. A client sends `subscribe` for a connection, gets one `snapshot`,
 * then every public hub event for that connection. A socket that closes or fails is
 * dropped without affecting the others.
 */
export class WsGateway {
  /** Socket → connection ids it subscribed to. */
  private readonly clients = new Map<WebSocket, Set<number>>();
  /** Socket → the user it signed in as (0 with accounts off). */
  private readonly users = new Map<WebSocket, number>();
  private readonly unsubscribeHub: () => void;

  constructor(
    hub: Hub,
    private readonly db: Db,
    private readonly connections: ReadonlyMap<number, NodeConnection>,
    private readonly logger: Logger = silentLogger,
    private readonly now: () => number = Date.now,
  ) {
    this.unsubscribeHub = hub.subscribeAll((event) => {
      this.onHubEvent(event);
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  attach(socket: WebSocket, userId = 0): void {
    this.clients.set(socket, new Set());
    this.users.set(socket, userId);
    socket.on("message", (data, isBinary) => {
      this.onClientMessage(socket, isBinary ? null : rawDataToString(data));
    });
    socket.on("close", () => {
      this.clients.delete(socket);
      this.users.delete(socket);
    });
    socket.on("error", (err) => {
      this.logger.debug({ err }, "websocket error");
      this.drop(socket);
    });
  }

  /** Closes every socket and stops listening to the hub. */
  close(): void {
    this.unsubscribeHub();
    for (const socket of this.clients.keys()) socket.terminate();
    this.clients.clear();
  }

  private onClientMessage(socket: WebSocket, text: string | null): void {
    let json: unknown;
    try {
      json = JSON.parse(text ?? "");
    } catch {
      this.send(socket, { type: "error", code: "bad_json", message: "messages must be JSON text" });
      return;
    }
    const parsed = ClientMessage.safeParse(json);
    if (!parsed.success) {
      this.send(socket, { type: "error", code: "bad_message", message: parsed.error.message });
      return;
    }
    const { connectionId } = parsed.data;
    if (!getConnection(this.db, connectionId)) {
      this.send(socket, {
        type: "error",
        code: "unknown_connection",
        message: `connection ${connectionId} not found`,
      });
      return;
    }
    this.clients.get(socket)?.add(connectionId);
    const state = this.connections.get(connectionId)?.state ?? "disconnected";
    this.send(socket, buildSnapshot(this.db, connectionId, state));
  }

  private onHubEvent(event: AnyEvent<HubEvents>): void {
    if (event.type === "message.new") {
      this.sendMessageNew(event.payload.message);
      return;
    }
    if (event.type === "notification-prefs.updated") {
      const { userId, prefs } = event.payload;
      const text = JSON.stringify({ type: "notification-prefs.updated", prefs });
      for (const [socket, user] of this.users) if (user === userId) this.sendText(socket, text);
      return;
    }
    const routed = toServerMessage(event);
    if (!routed) return;
    const text = JSON.stringify(routed.message);
    for (const [socket, subscriptions] of this.clients) {
      if (subscriptions.has(routed.connectionId)) this.sendText(socket, text);
    }
  }

  /** `message.new` with a `notify` hint for each socket's user (CR-003 §11). */
  private sendMessageNew(message: Message): void {
    const sockets = [...this.clients].filter(([, subs]) => subs.has(message.connectionId));
    if (sockets.length === 0) return;
    const ctx = this.messageContext(message);
    const byUser = new Map<number, string>();
    for (const [socket] of sockets) {
      const userId = this.users.get(socket) ?? 0;
      let text = byUser.get(userId);
      if (text === undefined) {
        const prefs = loadPrefs(this.db, userId, ctx.now);
        const notify = notifyHint(message, ctx, prefs);
        text = JSON.stringify({ type: "message.new", message, ...(notify ? { notify } : {}) });
        byUser.set(userId, text);
      }
      this.sendText(socket, text);
    }
  }

  private messageContext(m: Message): MessageContext {
    const me = getMyNodeNum(this.db, m.connectionId);
    const own = me === null ? null : getNode(this.db, m.connectionId, me);
    const kind = m.peer === null ? "channel" : "dm";
    const state = getState(this.db, m.connectionId, kind, m.peer ?? m.channelIndex);
    return {
      owner: own ? { longName: own.longName, shortName: own.shortName } : null,
      level: publicState(kind, state).notifyLevel,
      ignored: getNode(this.db, m.connectionId, m.fromNum)?.isIgnored ?? false,
      now: this.now(),
    };
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    this.sendText(socket, JSON.stringify(message));
  }

  private sendText(socket: WebSocket, text: string): void {
    if (socket.readyState !== WebSocket.OPEN) {
      this.drop(socket);
      return;
    }
    try {
      socket.send(text);
    } catch (err) {
      this.logger.debug({ err }, "websocket send failed");
      this.drop(socket);
    }
  }

  private drop(socket: WebSocket): void {
    this.clients.delete(socket);
    socket.terminate();
  }
}

/** The WS message for a public hub event and the connection it belongs to; null for internal events. */
function toServerMessage(
  event: AnyEvent<HubEvents>,
): { connectionId: number; message: ServerMessage } | null {
  switch (event.type) {
    case "connection.state":
      return {
        connectionId: event.payload.connectionId,
        message: { type: "connection.state", ...event.payload },
      };
    case "node.upsert":
      return {
        connectionId: event.payload.node.connectionId,
        message: { type: "node.upsert", ...event.payload },
      };
    case "message.new":
      return {
        connectionId: event.payload.message.connectionId,
        message: { type: "message.new", ...event.payload },
      };
    case "message.status":
      return {
        connectionId: event.payload.connectionId,
        message: { type: "message.status", ...event.payload },
      };
    case "telemetry.new":
      return {
        connectionId: event.payload.telemetry.connectionId,
        message: { type: "telemetry.new", ...event.payload },
      };
    case "position.new":
      return {
        connectionId: event.payload.position.connectionId,
        message: { type: "position.new", ...event.payload },
      };
    case "activity.new":
      return {
        connectionId: event.payload.activity.connectionId,
        message: { type: "activity.new", ...event.payload },
      };
    case "config.updated":
      return {
        connectionId: event.payload.connectionId,
        message: { type: "config.updated", ...event.payload },
      };
    case "config.apply":
      return {
        connectionId: event.payload.status.connectionId,
        message: { type: "config.apply", ...event.payload },
      };
    case "conversation.read":
      return {
        connectionId: event.payload.connectionId,
        message: { type: "conversation.read", ...event.payload },
      };
    case "conversation.updated":
      return {
        connectionId: event.payload.connectionId,
        message: { type: "conversation.updated", ...event.payload },
      };
    case "notifications.backlog":
      return {
        connectionId: event.payload.connectionId,
        message: { type: "notifications.backlog", ...event.payload },
      };
    default:
      return null;
  }
}

export function rawDataToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
