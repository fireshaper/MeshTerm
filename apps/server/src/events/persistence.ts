import { nodeIdFromNum, type MeshNode, type Message } from "@meshterm/shared";
import type { Db } from "../db/database.js";
import {
  findOutboundByPacketId,
  getMyNodeNum,
  getNode,
  insertMessage,
  setModemPreset,
  setMyNodeNum,
  updateMessageStatus,
  upsertChannel,
  upsertNode,
} from "../db/repositories.js";
import { recordPosition, recordTelemetry, setLastPacketAt, setNodeRssi } from "../db/telemetry.js";
import { silentLogger, type Logger } from "../logger.js";
import type { Hub, NodeUpdate } from "./events.js";

/**
 * Writes every `radio.*` event to SQLite and then publishes the public event built
 * from what was stored. Duplicates produce no `message.new`. Returns an unsubscribe.
 */
export function attachPersistence(
  hub: Hub,
  db: Db,
  logger: Logger = silentLogger,
  now: () => number = Date.now,
): () => void {
  const offs = [
    hub.subscribe("radio.myInfo", ({ connectionId, myNodeNum }) => {
      setMyNodeNum(db, connectionId, myNodeNum);
    }),

    hub.subscribe("radio.lora", ({ connectionId, modemPreset }) => {
      setModemPreset(db, connectionId, modemPreset);
    }),

    hub.subscribe("radio.node", ({ connectionId, update }) => {
      const existing = getNode(db, connectionId, update.num);
      const node = mergeNode(existing, update, connectionId);
      upsertNode(db, node);
      // RSSI follows the same "at least as recent" rule as SNR (see mergeNode).
      if (update.rssi !== undefined && isFresh(existing, update)) {
        setNodeRssi(db, connectionId, update.num, update.rssi);
      }
      hub.publish("node.upsert", { node });
    }),

    hub.subscribe("radio.packet", ({ connectionId, at }) => {
      setLastPacketAt(db, connectionId, at);
    }),

    hub.subscribe("radio.telemetry", ({ report }) => {
      // A repeat (e.g. the handshake re-sending a node's last metrics) isn't news.
      if (recordTelemetry(db, report)) hub.publish("telemetry.new", { telemetry: report });
    }),

    hub.subscribe("radio.position", ({ position }) => {
      if (recordPosition(db, position, now())) hub.publish("position.new", { position });
    }),

    hub.subscribe("radio.channel", ({ channel }) => {
      upsertChannel(db, channel);
      hub.publish("channel.upsert", { channel });
    }),

    hub.subscribe("radio.text", ({ message: decoded }) => {
      const message = classifyDm(decoded, getMyNodeNum(db, decoded.connectionId));
      if (insertMessage(db, message) === "duplicate") {
        logger.debug(
          { connectionId: message.connectionId, from: message.fromNum, packetId: message.packetId },
          "duplicate inbound message dropped",
        );
        return;
      }
      hub.publish("message.new", { message });
    }),

    hub.subscribe("radio.routing", ({ connectionId, requestId, status, error }) => {
      const message = findOutboundByPacketId(db, connectionId, requestId);
      if (!message) {
        logger.debug({ connectionId, requestId, status }, "routing reply for an unknown packet");
        return;
      }
      // An ACK is final: a late error for the same packet (e.g. a duplicate) doesn't undo it.
      if (message.status === "acked" || message.status === status) return;
      updateMessageStatus(db, message.id, status, error);
      if (error) logger.info({ connectionId, messageId: message.id, error }, "message failed");
      hub.publish("message.status", {
        connectionId,
        messageId: message.id,
        status,
        errorReason: error,
      });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/**
 * DMs are identified by destination. A text from our own node to someone else was
 * sent by another client on the node: an outgoing DM to `to`, not one from ourselves.
 */
export function classifyDm(message: Message, myNodeNum: number | null): Message {
  if (message.peer === null || myNodeNum === null || message.fromNum !== myNodeNum) return message;
  return { ...message, peer: message.toNum, direction: "out" };
}

/** Whether an update is at least as recent as what is stored, so its signal values apply. */
export function isFresh(existing: MeshNode | null, update: NodeUpdate): boolean {
  const stored = existing?.lastHeard ?? null;
  return update.lastHeard == null || stored === null || update.lastHeard >= stored;
}

/**
 * Applies what one packet or record told us to the stored node. Rules:
 * - absent fields keep their stored value;
 * - `lastHeard` never moves backwards;
 * - `snr`/`hopsAway` only apply if the update is at least as recent as what we have,
 *   so a stale NodeDB entry can't overwrite a fresh packet's signal.
 */
export function mergeNode(
  existing: MeshNode | null,
  update: NodeUpdate,
  connectionId: number,
): MeshNode {
  const base: MeshNode = existing ?? {
    connectionId,
    num: update.num,
    id: nodeIdFromNum(update.num),
    longName: "",
    shortName: "",
    hwModel: null,
    role: null,
    lastHeard: null,
    snr: null,
    hopsAway: null,
    isFavorite: false,
    hasPublicKey: false,
    isIgnored: false,
  };
  const { lastHeard, snr, hopsAway, ...rest } = update;
  // exactOptionalPropertyTypes: absent fields are missing keys, never `undefined`.
  const merged: MeshNode = { ...base, ...rest };

  const fresh = isFresh(existing, update);
  if (lastHeard != null && (base.lastHeard === null || lastHeard > base.lastHeard)) {
    merged.lastHeard = lastHeard;
  }
  if (fresh && snr !== undefined) merged.snr = snr;
  if (fresh && hopsAway !== undefined) merged.hopsAway = hopsAway;
  return merged;
}
