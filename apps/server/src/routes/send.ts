import {
  BROADCAST_NUM,
  ChannelIndex,
  MAX_TEXT_BYTES,
  Message,
  Uint32,
  utf8ByteLength,
} from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { MessageSender } from "../messaging/sender.js";

/** Per client IP, on the send endpoint only. See DECISIONS 7.7. */
export const SEND_RATE_LIMIT = { max: 10, timeWindow: 60_000 };

const SendBody = z
  .object({
    text: z
      .string()
      .refine((s) => s.trim().length > 0, "text must not be empty")
      .refine(
        (s) => utf8ByteLength(s) <= MAX_TEXT_BYTES,
        `text must be at most ${MAX_TEXT_BYTES} UTF-8 bytes`,
      ),
    channel: ChannelIndex.optional(),
    to: Uint32.refine((n) => n !== 0 && n !== BROADCAST_NUM, "to must be a node number").optional(),
  })
  .refine((b) => (b.channel === undefined) !== (b.to === undefined), {
    message: "give exactly one of channel or to",
  });

/** `POST /api/connections/:id/messages`: send a text to a channel or a node. */
export function sendRoutes(sender: MessageSender): FastifyPluginAsyncZod {
  return (app) => {
    app.post(
      "/api/connections/:id/messages",
      {
        config: { rateLimit: SEND_RATE_LIMIT },
        schema: {
          params: z.object({ id: z.coerce.number().int().positive() }),
          body: SendBody,
          response: { 201: z.object({ message: Message }) },
        },
      },
      (req, reply) => {
        const { text, channel, to } = req.body;
        const target = to !== undefined ? { to } : { channel: channel ?? 0 };
        const message = sender.send(req.params.id, text, target);
        void reply.code(201);
        return { message };
      },
    );
    return Promise.resolve();
  };
}
