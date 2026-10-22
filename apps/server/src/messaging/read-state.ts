import type { ConversationKind, ConversationState, NotifyLevel } from "@meshterm/shared";
import { and, eq, gt, isNull, notExists, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { conversationState, messages, nodes } from "../db/schema.js";

/**
 * Per-conversation state (Messages spec §5, `conversation_state`): how far it has been
 * read, mute/favorite, and for DMs where a delete cut it off. Shared by every user of
 * the connection; a conversation without a row has the defaults.
 */
export interface StoredState extends Omit<ConversationState, "notifyLevel"> {
  deletedBefore: number;
  /** null: the kind's default (see `defaultLevel`). */
  notifyLevel: NotifyLevel | null;
}

const DEFAULT_STATE: StoredState = {
  lastReadRxTime: 0,
  muted: false,
  favorite: false,
  deletedBefore: 0,
  notifyLevel: null,
};

/** CR-003 §4: channels notify on mentions only, DMs always. */
export const defaultLevel = (kind: ConversationKind): NotifyLevel =>
  kind === "channel" ? "mentions" : "dm-default";

/** What the API shows: the effective level, never null. */
export function publicState(kind: ConversationKind, s: StoredState): ConversationState {
  return {
    lastReadRxTime: s.lastReadRxTime,
    muted: s.muted,
    favorite: s.favorite,
    notifyLevel: s.notifyLevel ?? defaultLevel(kind),
  };
}

const keyOf = (kind: ConversationKind, key: number) => `${kind}:${key}`;

export function getState(
  db: Db,
  connectionId: number,
  kind: ConversationKind,
  key: number,
): StoredState {
  const [row] = db
    .select()
    .from(conversationState)
    .where(
      and(
        eq(conversationState.connectionId, connectionId),
        eq(conversationState.kind, kind),
        eq(conversationState.key, key),
      ),
    )
    .all();
  return row
    ? {
        lastReadRxTime: row.lastReadRxTime,
        muted: row.muted,
        favorite: row.favorite,
        deletedBefore: row.deletedBefore,
        notifyLevel: row.notifyLevel,
      }
    : { ...DEFAULT_STATE };
}

/** Every stored state of a connection, by `kind:key`. */
export function allStates(db: Db, connectionId: number): Map<string, StoredState> {
  return new Map(
    db
      .select()
      .from(conversationState)
      .where(eq(conversationState.connectionId, connectionId))
      .all()
      .map((r) => [
        keyOf(r.kind, r.key),
        {
          lastReadRxTime: r.lastReadRxTime,
          muted: r.muted,
          favorite: r.favorite,
          deletedBefore: r.deletedBefore,
          notifyLevel: r.notifyLevel,
        },
      ]),
  );
}

export const stateFrom = (states: Map<string, StoredState>, kind: ConversationKind, key: number) =>
  states.get(keyOf(kind, key)) ?? { ...DEFAULT_STATE };

function save(
  db: Db,
  connectionId: number,
  kind: ConversationKind,
  key: number,
  state: StoredState,
): void {
  db.insert(conversationState)
    .values({ connectionId, kind, key, ...state })
    .onConflictDoUpdate({
      target: [conversationState.connectionId, conversationState.kind, conversationState.key],
      set: state,
    })
    .run();
}

/** The messages of a conversation (DMs: after a delete). */
function conversationWhere(
  connectionId: number,
  kind: ConversationKind,
  key: number,
  deletedBefore: number,
): SQL | undefined {
  return kind === "channel"
    ? and(
        eq(messages.connectionId, connectionId),
        eq(messages.channelIndex, key),
        isNull(messages.peer),
      )
    : and(
        eq(messages.connectionId, connectionId),
        eq(messages.peer, key),
        gt(messages.rxTime, deletedBefore),
      );
}

/** The newest message time in a conversation; 0 when it has none. */
export function newestRxTime(
  db: Db,
  connectionId: number,
  kind: ConversationKind,
  key: number,
): number {
  const [row] = db
    .select({ newest: sql<number | null>`max(${messages.rxTime})` })
    .from(messages)
    .where(conversationWhere(connectionId, kind, key, 0))
    .all();
  return row?.newest ?? 0;
}

/**
 * Incoming messages after `lastReadRxTime`, not counting reactions or ignored nodes
 * (CR-003 §4: those never notify, so they don't nag as unread either).
 */
export function unreadCount(
  db: Db,
  connectionId: number,
  kind: ConversationKind,
  key: number,
  state: StoredState,
): number {
  const ignored = db
    .select({ one: sql`1` })
    .from(nodes)
    .where(
      and(
        eq(nodes.connectionId, messages.connectionId),
        eq(nodes.num, messages.fromNum),
        eq(nodes.isIgnored, true),
      ),
    );
  const [row] = db
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .where(
      and(
        conversationWhere(connectionId, kind, key, state.deletedBefore),
        eq(messages.direction, "in"),
        eq(messages.emoji, false),
        gt(messages.rxTime, state.lastReadRxTime),
        notExists(ignored),
      ),
    )
    .all();
  return row?.n ?? 0;
}

/**
 * Marks a conversation read up to `upTo` (default: its newest message). Never moves
 * backwards. Returns the new state.
 */
export function markRead(
  db: Db,
  connectionId: number,
  kind: ConversationKind,
  key: number,
  upTo?: number,
): StoredState {
  const state = getState(db, connectionId, kind, key);
  const target = upTo ?? newestRxTime(db, connectionId, kind, key);
  const next = { ...state, lastReadRxTime: Math.max(state.lastReadRxTime, target) };
  save(db, connectionId, kind, key, next);
  return next;
}

export function updateState(
  db: Db,
  connectionId: number,
  kind: ConversationKind,
  key: number,
  patch: Partial<StoredState>,
): StoredState {
  const next = { ...getState(db, connectionId, kind, key), ...patch };
  save(db, connectionId, kind, key, next);
  return next;
}
