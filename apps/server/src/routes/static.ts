import { sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyReply } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { indexHtmlRenderer } from "../security.js";

export interface StaticOptions {
  /** Built SPA; null serves nothing (dev, where Vite serves it). */
  webDir: string | null;
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
 * Serves the SPA when built (themes have their own route, routes/themes.ts). Vite puts hashed files in
 * `assets/`, so those are cached forever; everything else (index.html) revalidates.
 * Unknown GET paths fall back to index.html in the app's not-found handler.
 */
export function staticRoutes({ webDir }: StaticOptions): FastifyPluginAsyncZod {
  return async (app) => {
    if (webDir) {
      const renderIndex = indexHtmlRenderer(webDir);
      if (renderIndex) {
        // index.html carries a per-response CSP nonce, so it's never served as a file.
        const sendIndex = (_req: unknown, reply: FastifyReply) =>
          reply
            .header("cache-control", NO_CACHE)
            .type("text/html; charset=utf-8")
            .send(renderIndex(reply.raw));
        app.get("/", sendIndex);
        app.get("/index.html", sendIndex);
      }
      await app.register(fastifyStatic, {
        root: webDir,
        prefix: "/",
        index: false,
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
