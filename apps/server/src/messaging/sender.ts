import { randomUUID } from "node:crypto";
import { Portnums } from "@meshterm/protocol";
import { BROADCAST_NUM, type Message, type MessageStatus } from "@meshterm/shared";
import type { Clock, Random } from "../clock.js";
import type { NodeConnection } from "../connection/node-connection.js";
import type { Db } from "../db/database.js";
import {
  getConnection,
  getHopLimit,
  getMessage,
  getMyNodeNum,
  insertMessage,
  updateMessageStatus,
} from "../db/repositories.js";
import type { Hub } from "../events/events.js";
import { silentLogger, type Logger } from "../logger.js";
import { HttpError } from "../routes/http-error.js";

export type SendTarget = { channel: number } | { to: number };

export interface SenderDeps {
  db: Db;
  hub: Hub;
  connections: ReadonlyMap<number, NodeConnection>;
  clock: Clock;
  random: Random;
  /** A message still `queued`/`sent` this long after sending becomes `failed`. */
  ackTimeoutMs: number;
  logger?: Logger;
  newId?: () => string;
}

/** Meshtastic's default hop limit, for a node whose LoRa config we haven't seen. */
export const DEFAULT_HOP_LIMIT = 3;

/** Statuses that a later event may still change. */
const PENDING: ReadonlySet<MessageStatus> = new Set(["queued", "sent"]);

/**
 * Sends text messages: stores them as `queued`, writes them to the node (`sent`),
 * and fails them if no routing reply arrives in time. ACKs and NAKs themselves are
 * applied by the persistence subscriber.
 */
export class MessageSender {
  private readonly timers = new Set<() => void>();
  private readonly logger: Logger;
  private readonly newId: () => string;

  constructor(private readonly deps: SenderDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.newId = deps.newId ?? randomUUID;
  }

  /** Throws `HttpError` 404 (unknown connection) or 409 (not connected). */
  send(connectionId: number, text: string, target: SendTarget): Message {
    const { db, hub, connections, clock } = this.deps;
    if (!getConnection(db, connectionId)) {
      throw new HttpError(404, "not_found", `connection ${connectionId} not found`);
    }
    const conn = connections.get(connectionId);
    const myNodeNum = getMyNodeNum(db, connectionId);
    if (conn?.state !== "connected" || myNodeNum === null) {
      throw new HttpError(
        409,
        "not_connected",
        `connection ${connectionId} is ${conn?.state ?? "disabled"}`,
      );
    }

    const to = "to" in target ? target.to : BROADCAST_NUM;
    const channelIndex = "channel" in target ? target.channel : 0;
    const message = this.store({
      id: this.newId(),
      connectionId,
      packetId: 0,
      fromNum: myNodeNum,
      toNum: to,
      peer: "to" in target ? target.to : null,
      channelIndex,
      text,
      rxTime: clock.now(),
      direction: "out",
      status: "queued",
      rxSnr: null,
      rxRssi: null,
      pkiEncrypted: false,
      viaMqtt: false,
      replyId: null,
      emoji: false,
      hopStart: null,
      hopLimit: null,
      errorReason: null,
      relayed: false,
    });
    hub.publish("message.new", { message });

    try {
      conn.send({
        payloadVariant: {
          case: "packet",
          value: {
            id: message.packetId,
            to,
            channel: channelIndex,
            wantAck: true,
            // Unset means 0: direct neighbors only, never relayed. Use the node's own setting.
            hopLimit: getHopLimit(db, connectionId) ?? DEFAULT_HOP_LIMIT,
            payloadVariant: {
              case: "decoded",
              value: {
                portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
                payload: new TextEncoder().encode(text),
              },
            },
          },
        },
      });
    } catch (err) {
      this.logger.warn({ err, messageId: message.id }, "send to node failed");
      this.setStatus(message, "failed");
      return { ...message, status: "failed" };
    }
    this.setStatus(message, "sent");

    const cancel = clock.setTimer(this.deps.ackTimeoutMs, () => {
      this.timers.delete(cancel);
      const current = getMessage(db, message.id);
      // Relayed but unconfirmed DMs stay `sent`: they did go out over the mesh.
      if (current?.status && PENDING.has(current.status) && !current.relayed) {
        this.logger.info({ messageId: message.id }, "no routing reply; message failed");
        this.setStatus(current, "failed");
      }
    });
    this.timers.add(cancel);
    return getMessage(db, message.id) ?? { ...message, status: "sent" };
  }

  /** Cancels pending ACK timeouts. */
  close(): void {
    for (const cancel of this.timers) cancel();
    this.timers.clear();
  }

  /** Inserts with a fresh random non-zero packet id, retrying on the rare id clash. */
  private store(message: Message): Message {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = { ...message, packetId: Math.floor(this.deps.random() * 0xffff_ffff) + 1 };
      if (insertMessage(this.deps.db, candidate) === "inserted") return candidate;
    }
    throw new Error("could not pick an unused packet id");
  }

  private setStatus(message: Message, status: MessageStatus): void {
    updateMessageStatus(this.deps.db, message.id, status);
    this.deps.hub.publish("message.status", {
      connectionId: message.connectionId,
      messageId: message.id,
      status,
      errorReason: null,
      relayed: message.relayed,
    });
  }
}
