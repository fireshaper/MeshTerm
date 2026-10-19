import { sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

export interface StaticOptions {
  /** Built SPA; null serves nothing (dev, where Vite serves it). */
  webDir: string | null;
  themesDir: string | null;
}

/** Paths the SPA fallback must never answer. */
export const RESERVED_PREFIXES = ["/api/", "/api", "/ws", "/healthz", "/themes/"];

export function isReservedPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return RESERVED_PREFIXES.some(
    (p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`),
  );
}

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const NO_CACHE = "no-cache";

/**
 * Serves `/themes/<id>/…` and, when built, the SPA. Vite puts hashed files in
 * `assets/`, so those are cached forever; everything else (index.html) revalidates.
 * Unknown GET paths fall back to index.html in the app's not-found handler.
 */
export function staticRoutes({ webDir, themesDir }: StaticOptions): FastifyPluginAsyncZod {
  return async (app) => {
    if (themesDir) {
      await app.register(fastifyStatic, {
        root: themesDir,
        prefix: "/themes/",
        decorateReply: false,
        cacheControl: false,
        setHeaders: (reply) => {
          void reply.header("cache-control", NO_CACHE);
        },
      });
    }
    if (webDir) {
      await app.register(fastifyStatic, {
        root: webDir,
        prefix: "/",
        cacheControl: false,
        setHeaders: (reply, path) => {
          void reply.header(
            "cache-control",
            path.includes(`${sep}assets${sep}`) ? IMMUTABLE : NO_CACHE,
          );
        },
      });
    }
  };
}
