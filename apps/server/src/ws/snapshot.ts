import { SNAPSHOT_MESSAGES, type ConnectionState, type ServerMessageOf } from "@meshterm/shared";
import type { Db } from "../db/database.js";
import {
  getMyNodeNum,
  listChannelMessages,
  listChannels,
  listDmMessages,
  listDmPeers,
  listNodes,
} from "../db/repositories.js";

export { SNAPSHOT_MESSAGES };

/** Everything a client needs to render one connection, read from SQLite. */
export function buildSnapshot(
  db: Db,
  connectionId: number,
  state: ConnectionState,
): ServerMessageOf<"snapshot"> {
  const channels = listChannels(db, connectionId);
  const page = { limit: SNAPSHOT_MESSAGES };
  return {
    type: "snapshot",
    connectionId,
    state,
    myNodeNum: getMyNodeNum(db, connectionId),
    nodes: listNodes(db, connectionId),
    channels,
    // Repositories page newest first; snapshots are oldest first.
    channelMessages: channels
      .filter((c) => c.role !== "DISABLED")
      .map((c) => ({
        channelIndex: c.index,
        messages: listChannelMessages(db, connectionId, c.index, page).reverse(),
      })),
    dmMessages: listDmPeers(db, connectionId).map((peer) => ({
      peer,
      messages: listDmMessages(db, connectionId, peer, page).reverse(),
    })),
  };
}
