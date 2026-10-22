import { ConversationKind, ConversationState, NotifyLevel } from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { getConnection } from "../db/repositories.js";
import {
  defaultLevel,
  markRead,
  newestRxTime,
  publicState,
  updateState,
} from "../messaging/read-state.js";
import { HttpError } from "./http-error.js";

const Params = z.object({
  id: z.coerce.number().int().positive(),
  kind: ConversationKind,
  key: z.coerce.number().int().nonnegative().max(0xffff_ffff),
});

/**
 * Read state and list preferences of conversations (Messages spec §6, CR-003 N0).
 * Marking read is open to every signed-in user (it changes nothing on the node);
 * mute, favorite and delete are admin actions.
 */
export const conversationRoutes: FastifyPluginAsyncZod = (app) => {
  const { db, hub } = app.meshterm;
  const check = (id: number, kind: ConversationKind, key: number) => {
    if (!getConnection(db, id)) throw new HttpError(404, "not_found", `connection ${id} not found`);
    if (kind === "channel" && key > 7) throw new HttpError(400, "invalid", "channel index 0–7");
  };

  app.post(
    "/api/connections/:id/conversations/:kind/:key/read",
    {
      schema: {
        params: Params,
        body: z.object({ upTo: z.number().int().nonnegative().optional() }).nullish(),
        response: { 200: ConversationState },
      },
    },
    (req) => {
      const { id, kind, key } = req.params;
      check(id, kind, key);
      const before = newestRxTime(db, id, kind, key);
      // Never past the newest message: a future mark would hide messages yet to come.
      const upTo = Math.min(req.body?.upTo ?? before, before);
      const state = markRead(db, id, kind, key, upTo);
      hub.publish("conversation.read", {
        connectionId: id,
        kind,
        key,
        lastReadRxTime: state.lastReadRxTime,
      });
      return publicState(kind, state);
    },
  );

  app.patch(
    "/api/connections/:id/conversations/:kind/:key",
    {
      config: { role: "admin" },
      schema: {
        params: Params,
        body: z
          .object({
            muted: z.boolean().optional(),
            favorite: z.boolean().optional(),
            notifyLevel: NotifyLevel.optional(),
          })
          .refine((b) => Object.values(b).some((v) => v !== undefined), "nothing to change"),
        response: { 200: ConversationState },
      },
    },
    (req) => {
      const { id, kind, key } = req.params;
      check(id, kind, key);
      const { muted, favorite, notifyLevel } = req.body;
      // Mute is the "none" level (CR-003 §4): setting one sets the other.
      const level =
        notifyLevel !== undefined
          ? {
              notifyLevel: notifyLevel === defaultLevel(kind) ? null : notifyLevel,
              muted: notifyLevel === "none",
            }
          : muted !== undefined
            ? { muted, notifyLevel: muted ? ("none" as const) : null }
            : {};
      const state = updateState(db, id, kind, key, {
        ...level,
        ...(favorite === undefined ? {} : { favorite }),
      });
      hub.publish("conversation.updated", {
        connectionId: id,
        kind,
        key,
        state: publicState(kind, state),
        deletedBefore: state.deletedBefore,
      });
      return publicState(kind, state);
    },
  );

  /** Hides a DM's history (MeshTerm only; nothing is sent). A newer message brings it back. */
  app.delete(
    "/api/connections/:id/conversations/dm/:peer",
    {
      config: { role: "admin" },
      schema: {
        params: z.object({
          id: z.coerce.number().int().positive(),
          peer: z.coerce.number().int().positive().max(0xffff_ffff),
        }),
        response: { 200: z.object({ deletedBefore: z.number().int().nonnegative() }) },
      },
    },
    (req) => {
      const { id, peer } = req.params;
      check(id, "dm", peer);
      const newest = newestRxTime(db, id, "dm", peer);
      const state = updateState(db, id, "dm", peer, {
        deletedBefore: newest,
        lastReadRxTime: newest,
      });
      hub.publish("conversation.updated", {
        connectionId: id,
        kind: "dm",
        key: peer,
        state: publicState("dm", state),
        deletedBefore: state.deletedBefore,
      });
      return { deletedBefore: state.deletedBefore };
    },
  );

  return Promise.resolve();
};
