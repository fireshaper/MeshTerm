import {
  Channel,
  ChannelIndex,
  Connection,
  ConnectionState,
  ConversationsDTO,
  MeshNode,
  Message,
  messageCursor,
  Uint32,
} from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  getConnection,
  getMyNodeNum,
  listChannelMessages,
  listChannels,
  listConnections,
  listDmMessages,
  listNodes,
  MAX_PAGE_SIZE,
  nextCursor,
  type MessageCursor,
} from "../db/repositories.js";
import { buildConversations } from "../messaging/conversations.js";
import { HttpError } from "./http-error.js";

/** The opaque `before`/`nextCursor` string of message pages; see `messageCursor`. */
export const encodeCursor = (cursor: MessageCursor): string => messageCursor(cursor);

const Cursor = z
  .string()
  .regex(/^\d+_[0-9a-f-]{36}$/i, "must be a nextCursor value from a previous page")
  .transform((s): MessageCursor => {
    const at = s.indexOf("_");
    return { rxTime: Number(s.slice(0, at)), id: s.slice(at + 1) };
  });

const ConnectionParams = z.object({ id: z.coerce.number().int().positive() });

const MessagesQuery = z
  .object({
    channel: z.coerce.number().pipe(ChannelIndex).optional(),
    peer: z.coerce.number().pipe(Uint32).optional(),
    before: Cursor.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  })
  .refine((q) => (q.channel === undefined) !== (q.peer === undefined), {
    message: "give exactly one of channel or peer",
  });

const ConnectionView = Connection.extend({
  /** null when the connection is disabled (no NodeConnection running). */
  state: ConnectionState.nullable(),
  myNodeNum: Uint32.nullable(),
});

const NotFound = z.object({ error: z.literal("not_found"), message: z.string() });

/** Read-only REST API under `/api`. */
export const apiRoutes: FastifyPluginAsyncZod = (app) => {
  const { db, connections } = app.meshterm;
  const requireConnection = (id: number) => {
    if (!getConnection(db, id)) throw new HttpError(404, "not_found", `connection ${id} not found`);
  };

  app.get("/api/connections", { schema: { response: { 200: z.array(ConnectionView) } } }, () =>
    listConnections(db).map((c) => ({
      ...c,
      state: connections.get(c.id)?.state ?? null,
      myNodeNum: getMyNodeNum(db, c.id),
    })),
  );

  app.get(
    "/api/connections/:id/nodes",
    { schema: { params: ConnectionParams, response: { 200: z.array(MeshNode), 404: NotFound } } },
    (req) => {
      const { id } = req.params;
      requireConnection(id);
      return listNodes(db, id);
    },
  );

  app.get(
    "/api/connections/:id/channels",
    // The response schema is the shared Channel, which has no PSK field and strips unknown keys.
    { schema: { params: ConnectionParams, response: { 200: z.array(Channel), 404: NotFound } } },
    (req) => {
      const { id } = req.params;
      requireConnection(id);
      return listChannels(db, id);
    },
  );

  app.get(
    "/api/connections/:id/conversations",
    { schema: { params: ConnectionParams, response: { 200: ConversationsDTO, 404: NotFound } } },
    (req) => {
      const { id } = req.params;
      requireConnection(id);
      return buildConversations(db, id);
    },
  );

  app.get(
    "/api/connections/:id/messages",
    {
      schema: {
        params: ConnectionParams,
        querystring: MessagesQuery,
        response: {
          200: z.object({ messages: z.array(Message), nextCursor: z.string().nullable() }),
          404: NotFound,
        },
      },
    },
    (req) => {
      const { id } = req.params;
      requireConnection(id);
      const { channel, peer, before, limit } = req.query;
      const page = { limit, ...(before ? { before } : {}) };
      const messages =
        channel !== undefined
          ? listChannelMessages(db, id, channel, page)
          : listDmMessages(db, id, peer ?? 0, page);
      const next = nextCursor(messages, limit);
      return { messages, nextCursor: next ? encodeCursor(next) : null };
    },
  );

  return Promise.resolve();
};
