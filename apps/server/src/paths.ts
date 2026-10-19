import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Paths are resolved from this module, which sits two levels below the repo's apps/
// folder both in source (apps/server/src/) and when bundled (apps/server/dist/).
// The Docker image keeps the same layout.
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** The built SPA, or null when there isn't one (e.g. during `pnpm dev`, where Vite serves it). */
export function resolveWebDir(configured: string | null): string | null {
  const dir = configured ?? here("../../web/dist/");
  return existsSync(join(dir, "index.html")) ? dir : null;
}

/** The built-in themes folder (`themes/<id>/theme.css`), or null if missing. */
export function resolveThemesDir(configured: string | null): string | null {
  const dir = configured ?? here("../../../themes/");
  return existsSync(dir) ? dir : null;
}
