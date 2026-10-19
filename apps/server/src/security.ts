import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

/** `'sha256-…'` sources for every inline `<style>` block in an HTML page. */
export function inlineStyleHashes(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
    ([, css]) =>
      `'sha256-${createHash("sha256")
        .update(css ?? "")
        .digest("base64")}'`,
  );
}

/**
 * The Content Security Policy. Everything loads from this server (tiles come through
 * the tile proxy, so `img-src` stays `'self'`). The only inline element is index.html's
 * layer-order `<style>`, allowed by hash. Inline style *attributes* are allowed: React
 * uses them for computed layout (e.g. virtualized rows); they can't run script.
 */
export function cspDirectives(styleHashes: readonly string[]): Record<string, string[] | null> {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    styleSrcElem: ["'self'", ...styleHashes],
    styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    workerSrc: ["'self'"],
    manifestSrc: ["'self'"],
    // Off on purpose: MeshTerm is usually reached over plain HTTP on a LAN, where this
    // would make browsers rewrite every request to HTTPS and break the page.
    upgradeInsecureRequests: null,
  };
}

/** Security headers (Helmet) with the CSP above. The style hash comes from the built index.html. */
export async function registerSecurityHeaders(
  app: FastifyInstance,
  webDir: string | null,
): Promise<void> {
  const indexHtml = webDir ? join(webDir, "index.html") : null;
  const hashes =
    indexHtml && existsSync(indexHtml) ? inlineStyleHashes(readFileSync(indexHtml, "utf8")) : [];
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: cspDirectives(hashes) },
    // HTTPS isn't assumed (LAN), and HSTS on a shared domain behind a proxy can do harm.
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
  });
}
