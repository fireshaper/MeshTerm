import { nodeIdFromNum, type MeshNode } from "@meshterm/shared";
import type { Db } from "../db/database.js";
import {
  findOutboundByPacketId,
  getNode,
  insertMessage,
  setMyNodeNum,
  updateMessageStatus,
  upsertChannel,
  upsertNode,
} from "../db/repositories.js";
import { silentLogger, type Logger } from "../logger.js";
import type { Hub, NodeUpdate } from "./events.js";

/**
 * Writes every `radio.*` event to SQLite and then publishes the public event built
 * from what was stored. Duplicates produce no `message.new`. Returns an unsubscribe.
 */
export function attachPersistence(hub: Hub, db: Db, logger: Logger = silentLogger): () => void {
  const offs = [
    hub.subscribe("radio.myInfo", ({ connectionId, myNodeNum }) => {
      setMyNodeNum(db, connectionId, myNodeNum);
    }),

    hub.subscribe("radio.node", ({ connectionId, update }) => {
      const node = mergeNode(getNode(db, connectionId, update.num), update, connectionId);
      upsertNode(db, node);
      hub.publish("node.upsert", { node });
    }),

    hub.subscribe("radio.channel", ({ channel }) => {
      upsertChannel(db, channel);
      hub.publish("channel.upsert", { channel });
    }),

    hub.subscribe("radio.text", ({ message }) => {
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
      updateMessageStatus(db, message.id, status);
      if (error) logger.info({ connectionId, messageId: message.id, error }, "message failed");
      hub.publish("message.status", { connectionId, messageId: message.id, status });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
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
  };
  const { lastHeard, snr, hopsAway, ...rest } = update;
  // exactOptionalPropertyTypes: absent fields are missing keys, never `undefined`.
  const merged: MeshNode = { ...base, ...rest };

  const fresh = lastHeard == null || base.lastHeard === null || lastHeard >= base.lastHeard;
  if (lastHeard != null && (base.lastHeard === null || lastHeard > base.lastHeard)) {
    merged.lastHeard = lastHeard;
  }
  if (fresh && snr !== undefined) merged.snr = snr;
  if (fresh && hopsAway !== undefined) merged.hopsAway = hopsAway;
  return merged;
}
