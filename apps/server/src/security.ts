import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
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

/** index.html carries this in `<meta name="mt-csp-nonce">`; each response gets a real nonce. */
export const CSP_NONCE_PLACEHOLDER = "__MESHTERM_CSP_NONCE__";

type NoncedResponse = ServerResponse & { mtCspNonce?: string };

/** This response's style nonce (set for every request by `registerSecurityHeaders`). */
export const cspNonceOf = (res: ServerResponse): string => (res as NoncedResponse).mtCspNonce ?? "";

type Directive = string | ((req: IncomingMessage, res: ServerResponse) => string);

/**
 * The Content Security Policy. Everything loads from this server (tiles come through
 * the tile proxy, so `img-src` stays `'self'`). Inline `<style>` elements: index.html's
 * layer-order block (by hash) and the ones libraries insert at runtime (Radix's scroll
 * lock), which carry the per-response nonce. Inline style *attributes* are allowed:
 * React uses them for computed layout (e.g. virtualized rows); they can't run script.
 */
export function cspDirectives(styleHashes: readonly string[]): Record<string, Directive[] | null> {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    styleSrcElem: ["'self'", ...styleHashes, (_req, res) => `'nonce-${cspNonceOf(res)}'`],
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
  // Before Helmet's own hook, which builds the header from it.
  app.addHook("onRequest", (_req, reply, done) => {
    (reply.raw as NoncedResponse).mtCspNonce = randomBytes(16).toString("base64");
    done();
  });
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: cspDirectives(hashes) },
    // HTTPS isn't assumed (LAN), and HSTS on a shared domain behind a proxy can do harm.
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * index.html with this response's nonce in place of the placeholder (read once, then
 * from memory). Null without a built SPA.
 */
export function indexHtmlRenderer(webDir: string | null): ((res: ServerResponse) => string) | null {
  const path = webDir ? join(webDir, "index.html") : null;
  if (!path || !existsSync(path)) return null;
  const html = readFileSync(path, "utf8");
  return (res) => html.split(CSP_NONCE_PLACEHOLDER).join(cspNonceOf(res));
}
