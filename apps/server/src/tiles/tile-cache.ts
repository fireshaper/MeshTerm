import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

export const DEFAULT_TTL_MS = 30 * 24 * 3600 * 1000;
export const USER_AGENT =
  "MeshTerm/0.1 (self-hosted Meshtastic client; +https://github.com/fireshaper/MeshTerm)";
const MAX_ZOOM = 19;

export interface TileCacheOptions {
  /** Cache root, e.g. `<data>/tiles`. Tiles live at `<dir>/<z>/<x>/<y>.png`. */
  dir: string;
  /** Upstream URL template with `{z}`, `{x}`, `{y}`. */
  upstream: string;
  maxBytes: number;
  ttlMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface Tile {
  body: Buffer;
  contentType: string;
  /** `hit` (fresh from disk), `miss` (fetched now), `stale` (upstream failed, old copy served). */
  source: "hit" | "miss" | "stale";
}

export class TileError extends Error {
  constructor(
    readonly status: 400 | 502,
    message: string,
  ) {
    super(message);
    this.name = "TileError";
  }
}

interface Entry {
  size: number;
  /** Expiry is also stored as the file's mtime, so it survives restarts. */
  expiresAt: number;
  lastUsed: number;
}

/**
 * Proxy + on-disk LRU cache for map tiles. Keeps the browser on `img-src 'self'`,
 * works offline for tiles seen before, and spares the upstream (OpenStreetMap's tile
 * policy asks for caching and an identifying User-Agent).
 */
export class TileCache {
  private readonly entries = new Map<string, Entry>();
  private totalBytes = 0;
  private loaded: Promise<void> | null = null;
  private readonly inFlight = new Map<string, Promise<Tile>>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TileCacheOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get sizeBytes(): number {
    return this.totalBytes;
  }

  /** Throws `TileError` 400 for coordinates outside the zoom level, 502 when upstream fails with nothing cached. */
  async get(z: number, x: number, y: number): Promise<Tile> {
    validate(z, x, y);
    await this.load();
    const key = `${z}/${x}/${y}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const work = this.fetchOrServe(key, z, x, y).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  private async fetchOrServe(key: string, z: number, x: number, y: number): Promise<Tile> {
    const entry = this.entries.get(key);
    const file = this.fileFor(key);
    if (entry && entry.expiresAt > this.now()) {
      entry.lastUsed = this.now();
      return { body: await readFile(file), contentType: "image/png", source: "hit" };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.urlFor(z, x, y), {
        headers: { "user-agent": USER_AGENT, accept: "image/png,image/*" },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch (err) {
      return this.staleOr(entry, file, `tile upstream unreachable: ${String(err)}`);
    }
    if (!response.ok) {
      return this.staleOr(entry, file, `tile upstream answered ${response.status}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "image/png";
    const ttl = cacheTtl(response.headers.get("cache-control"), this.ttlMs);
    if (ttl > 0) await this.store(key, file, body, this.now() + ttl);
    return { body, contentType, source: "miss" };
  }

  private async staleOr(entry: Entry | undefined, file: string, message: string): Promise<Tile> {
    if (entry) {
      entry.lastUsed = this.now();
      return { body: await readFile(file), contentType: "image/png", source: "stale" };
    }
    throw new TileError(502, message);
  }

  private async store(key: string, file: string, body: Buffer, expiresAt: number): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    await utimes(file, expiresAt / 1000, expiresAt / 1000);
    const old = this.entries.get(key);
    if (old) this.totalBytes -= old.size;
    this.entries.set(key, { size: body.length, expiresAt, lastUsed: this.now() });
    this.totalBytes += body.length;
    await this.evict(key);
  }

  /** Drops least recently used tiles until under the cap (never the one just stored). */
  private async evict(keep: string): Promise<void> {
    if (this.totalBytes <= this.options.maxBytes) return;
    const byAge = [...this.entries].sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
    for (const [key, entry] of byAge) {
      if (this.totalBytes <= this.options.maxBytes) break;
      if (key === keep) continue;
      this.entries.delete(key);
      this.totalBytes -= entry.size;
      await rm(this.fileFor(key), { force: true });
    }
  }

  /** Indexes what is already on disk, once. Older expiry counts as less recently used. */
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      await mkdir(this.options.dir, { recursive: true });
      for (const file of await walk(this.options.dir)) {
        const key = relative(this.options.dir, file)
          .split(sep)
          .join("/")
          .replace(/\.png$/, "");
        if (!/^\d+\/\d+\/\d+$/.test(key)) continue;
        const s = await stat(file);
        this.entries.set(key, { size: s.size, expiresAt: s.mtimeMs, lastUsed: s.mtimeMs });
        this.totalBytes += s.size;
      }
    })();
    return this.loaded;
  }

  private fileFor(key: string): string {
    return join(this.options.dir, ...key.split("/")) + ".png";
  }

  private urlFor(z: number, x: number, y: number): string {
    return this.options.upstream
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
  }
}

function validate(z: number, x: number, y: number): void {
  const ok =
    Number.isInteger(z) && z >= 0 && z <= MAX_ZOOM && Number.isInteger(x) && Number.isInteger(y);
  const max = 2 ** z;
  if (!ok || x < 0 || y < 0 || x >= max || y >= max) {
    throw new TileError(400, `no tile ${z}/${x}/${y}`);
  }
}

/** Our TTL, shortened by the upstream's `max-age`; 0 for `no-store`/`no-cache`. */
export function cacheTtl(cacheControl: string | null, ttlMs: number): number {
  if (!cacheControl) return ttlMs;
  const directives = cacheControl.toLowerCase();
  if (/\bno-store\b|\bno-cache\b/.test(directives)) return 0;
  const maxAge = /\bmax-age=(\d+)/.exec(directives)?.[1];
  return maxAge === undefined ? ttlMs : Math.min(ttlMs, Number(maxAge) * 1000);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
