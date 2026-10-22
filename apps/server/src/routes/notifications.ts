import { NotificationPrefsDTO, NotificationPrefsPatch } from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { loadPrefs, savePrefs } from "../messaging/notify.js";

/**
 * The signed-in user's notification settings (CR-003 §10): Do Not Disturb, quiet hours,
 * mention keywords, reactions. Changes reach the user's other browsers over WS.
 */
export const notificationRoutes: FastifyPluginAsyncZod = (app) => {
  const { db, hub, clock } = app.meshterm;

  app.get(
    "/api/me/notification-prefs",
    { schema: { response: { 200: NotificationPrefsDTO } } },
    (req) => loadPrefs(db, req.auth?.id ?? 0, clock.now()),
  );

  app.patch(
    "/api/me/notification-prefs",
    { schema: { body: NotificationPrefsPatch, response: { 200: NotificationPrefsDTO } } },
    (req) => {
      const userId = req.auth?.id ?? 0;
      const prefs = savePrefs(db, userId, req.body, clock.now());
      hub.publish("notification-prefs.updated", { userId, prefs });
      return prefs;
    },
  );

  return Promise.resolve();
};
