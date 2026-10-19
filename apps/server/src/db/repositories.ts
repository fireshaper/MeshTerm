import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import {
  nodeIdFromNum,
  type Channel,
  type Connection,
  type MeshNode,
  type Message,
  type MessageStatus,
} from "@meshterm/shared";
import type { Db } from "./database.js";
import { channels, connections, messages, nodes } from "./schema.js";

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Position in a newest-first message list: rows strictly older than this message.
 * Firmware `rx_time` has one-second resolution, so a bare timestamp can't tell
 * apart messages from the same second; the id breaks ties.
 */
export interface MessageCursor {
  rxTime: number;
  id: string;
}

export interface PageOptions {
  before?: MessageCursor;
  /** 1 to {@link MAX_PAGE_SIZE}; default {@link DEFAULT_PAGE_SIZE}. */
  limit?: number;
}

// ---------------------------------------------------------------- connections

export function listConnections(db: Db): Connection[] {
  return db
    .select({
      id: connections.id,
      name: connections.name,
      host: connections.host,
      port: connections.port,
      transport: connections.transport,
      enabled: connections.enabled,
    })
    .from(connections)
    .orderBy(asc(connections.id))
    .all();
}

export function getConnection(db: Db, id: number): Connection | null {
  return listConnections(db).find((c) => c.id === id) ?? null;
}

/** Our node's number on that connection, from the last handshake. */
export function getMyNodeNum(db: Db, connectionId: number): number | null {
  return (
    db
      .select({ myNodeNum: connections.myNodeNum })
      .from(connections)
      .where(eq(connections.id, connectionId))
      .get()?.myNodeNum ?? null
  );
}

export function setMyNodeNum(db: Db, connectionId: number, myNodeNum: number): void {
  db.update(connections).set({ myNodeNum }).where(eq(connections.id, connectionId)).run();
}

// ---------------------------------------------------------------------- nodes

type NodeRow = typeof nodes.$inferSelect;

/** The shared `MeshNode` fields only; the row also carries the dashboard's latest-value columns. */
function toMeshNode(row: NodeRow): MeshNode {
  return {
    connectionId: row.connectionId,
    num: row.num,
    id: nodeIdFromNum(row.num),
    longName: row.longName,
    shortName: row.shortName,
    hwModel: row.hwModel,
    role: row.role,
    lastHeard: row.lastHeard,
    snr: row.snr,
    hopsAway: row.hopsAway,
    isFavorite: row.favoriteOverride ?? row.isFavorite,
  };
}

export function upsertNode(db: Db, node: MeshNode): void {
  const { id: _id, ...row } = node;
  const { connectionId: _c, num: _n, ...update } = row;
  db.insert(nodes)
    .values(row)
    .onConflictDoUpdate({ target: [nodes.connectionId, nodes.num], set: update })
    .run();
}

export function getNode(db: Db, connectionId: number, num: number): MeshNode | null {
  const row = db
    .select()
    .from(nodes)
    .where(and(eq(nodes.connectionId, connectionId), eq(nodes.num, num)))
    .get();
  return row ? toMeshNode(row) : null;
}

/** Nodes of one connection, most recently heard first (never-heard last). */
export function listNodes(db: Db, connectionId: number): MeshNode[] {
  return db
    .select()
    .from(nodes)
    .where(eq(nodes.connectionId, connectionId))
    .orderBy(sql`${nodes.lastHeard} IS NULL`, desc(nodes.lastHeard), asc(nodes.num))
    .all()
    .map(toMeshNode);
}

// ------------------------------------------------------------------- channels

export function upsertChannel(db: Db, channel: Channel): void {
  const row = {
    connectionId: channel.connectionId,
    channelIndex: channel.index,
    name: channel.name,
    role: channel.role,
  };
  db.insert(channels)
    .values(row)
    .onConflictDoUpdate({
      target: [channels.connectionId, channels.channelIndex],
      set: { name: row.name, role: row.role },
    })
    .run();
}

export function listChannels(db: Db, connectionId: number): Channel[] {
  return db
    .select()
    .from(channels)
    .where(eq(channels.connectionId, connectionId))
    .orderBy(asc(channels.channelIndex))
    .all()
    .map(({ channelIndex, ...rest }) => ({ ...rest, index: channelIndex }));
}

// ------------------------------------------------------------------- messages

export type InsertMessageResult = "inserted" | "duplicate";

/**
 * Inserts a message. A second copy of the same packet (same connection, sender and
 * packet id, e.g. heard again via a rebroadcast) is not stored and reports "duplicate".
 */
export function insertMessage(db: Db, message: Message): InsertMessageResult {
  const { changes } = db
    .insert(messages)
    .values(message)
    .onConflictDoNothing({ target: [messages.connectionId, messages.fromNum, messages.packetId] })
    .run();
  return changes > 0 ? "inserted" : "duplicate";
}

/** Returns false when no message has that id. */
export function updateMessageStatus(db: Db, id: string, status: MessageStatus): boolean {
  return db.update(messages).set({ status }).where(eq(messages.id, id)).run().changes > 0;
}

/** The message we sent with this packet id, for matching routing ACKs. */
export function findOutboundByPacketId(
  db: Db,
  connectionId: number,
  packetId: number,
): Message | null {
  return (
    db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.connectionId, connectionId),
          eq(messages.packetId, packetId),
          eq(messages.direction, "out"),
        ),
      )
      .get() ?? null
  );
}

export function getMessage(db: Db, id: string): Message | null {
  return db.select().from(messages).where(eq(messages.id, id)).get() ?? null;
}

/** Broadcast messages on one channel, newest first. */
export function listChannelMessages(
  db: Db,
  connectionId: number,
  channelIndex: number,
  page: PageOptions = {},
): Message[] {
  return listMessages(
    db,
    and(
      eq(messages.connectionId, connectionId),
      eq(messages.channelIndex, channelIndex),
      isNull(messages.peer),
    ),
    page,
  );
}

/** Both directions of the DM conversation with `peer`, newest first. */
export function listDmMessages(
  db: Db,
  connectionId: number,
  peer: number,
  page: PageOptions = {},
): Message[] {
  return listMessages(
    db,
    and(eq(messages.connectionId, connectionId), eq(messages.peer, peer)),
    page,
  );
}

function listMessages(db: Db, where: SQL | undefined, page: PageOptions): Message[] {
  const limit = page.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}, got ${limit}`);
  }
  const { before } = page;
  const olderThanCursor = before
    ? sql`(${messages.rxTime}, ${messages.id}) < (${before.rxTime}, ${before.id})`
    : undefined;
  return db
    .select()
    .from(messages)
    .where(and(where, olderThanCursor))
    .orderBy(desc(messages.rxTime), desc(messages.id))
    .limit(limit)
    .all();
}

/** The cursor for the page after `page` (null when it was the last one). */
export function nextCursor(page: Message[], limit: number): MessageCursor | null {
  const last = page.at(-1);
  return last && page.length === limit ? { rxTime: last.rxTime, id: last.id } : null;
}

/** Everyone we have a DM conversation with, most recent conversation first. */
export function listDmPeers(db: Db, connectionId: number): number[] {
  return db
    .select({ peer: messages.peer, last: sql<number>`max(${messages.rxTime})` })
    .from(messages)
    .where(and(eq(messages.connectionId, connectionId), isNotNull(messages.peer)))
    .groupBy(messages.peer)
    .orderBy(desc(sql`max(${messages.rxTime})`))
    .all()
    .flatMap((r) => (r.peer === null ? [] : [r.peer]));
}
