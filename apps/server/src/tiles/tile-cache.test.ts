import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeTileServer, tilePng } from "@meshterm/fake-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test-app.js";
import { cacheTtl, TileCache, TileError } from "./tile-cache.js";

const DAY = 24 * 3600 * 1000;
let upstream: FakeTileServer;
let dir: string;
let now: number;

beforeEach(async () => {
  upstream = new FakeTileServer();
  await upstream.start();
  dir = mkdtempSync(join(tmpdir(), "meshterm-tiles-"));
  now = 1_800_000_000_000;
});

afterEach(async () => {
  await upstream.stop();
  rmSync(dir, { recursive: true, force: true });
});

const cache = (maxBytes = 50 * 1024 * 1024) =>
  new TileCache({ dir, upstream: upstream.urlTemplate, maxBytes, now: () => now });
const tileFile = (z: number, x: number, y: number) => join(dir, String(z), String(x), `${y}.png`);

describe("TileCache", () => {
  it("fetches once, then serves from disk", async () => {
    const tiles = cache();
    const first = await tiles.get(14, 2621, 5718);
    expect(first.source).toBe("miss");
    expect(first.body.equals(tilePng(14, 2621, 5718))).toBe(true);
    const second = await tiles.get(14, 2621, 5718);
    expect(second.source).toBe("hit");
    expect(second.body.equals(first.body)).toBe(true);
    expect(upstream.hits).toEqual(["14/2621/5718"]);
    expect(existsSync(tileFile(14, 2621, 5718))).toBe(true);
  });

  it("refetches after the 30-day TTL, or sooner when upstream max-age is shorter", async () => {
    upstream.cacheControl = null; // our own TTL applies
    const tiles = cache();
    await tiles.get(10, 1, 1);
    now += 29 * DAY;
    expect((await tiles.get(10, 1, 1)).source).toBe("hit");
    now += 2 * DAY;
    expect((await tiles.get(10, 1, 1)).source).toBe("miss");

    upstream.cacheControl = "public, max-age=60";
    await tiles.get(10, 2, 2);
    now += 61_000;
    expect((await tiles.get(10, 2, 2)).source).toBe("miss");
    expect(upstream.hits).toEqual(["10/1/1", "10/1/1", "10/2/2", "10/2/2"]);
  });

  it("doesn't cache no-store responses", async () => {
    upstream.cacheControl = "no-store";
    const tiles = cache();
    await tiles.get(5, 1, 1);
    await tiles.get(5, 1, 1);
    expect(upstream.hits).toHaveLength(2);
    expect(existsSync(tileFile(5, 1, 1))).toBe(false);
  });

  it("evicts the least recently used tiles to stay under the size cap", async () => {
    const size = tilePng(3, 0, 0).length + 64; // tiles differ slightly in size
    const tiles = cache(size * 2);
    await tiles.get(3, 0, 0);
    now += 1;
    await tiles.get(3, 1, 0);
    now += 1;
    await tiles.get(3, 0, 0); // touch: (3,1,0) is now the least recently used
    now += 1;
    await tiles.get(3, 2, 0);
    expect(existsSync(tileFile(3, 1, 0))).toBe(false);
    expect(existsSync(tileFile(3, 0, 0))).toBe(true);
    expect(existsSync(tileFile(3, 2, 0))).toBe(true);
    expect(tiles.sizeBytes).toBeLessThanOrEqual(size * 2);
  });

  it("answers 502 when upstream fails and nothing is cached, and serves a stale copy when one is", async () => {
    const tiles = cache();
    upstream.failWith = 503;
    await expect(tiles.get(4, 1, 1)).rejects.toMatchObject({ status: 502 });
    expect(existsSync(tileFile(4, 1, 1))).toBe(false);

    upstream.failWith = null;
    await tiles.get(4, 2, 2);
    now += 40 * DAY; // expired
    upstream.failWith = 500;
    expect((await tiles.get(4, 2, 2)).source).toBe("stale");
  });

  it("rejects coordinates outside the zoom level", async () => {
    const tiles = cache();
    for (const [z, x, y] of [
      [2, 4, 0],
      [2, 0, -1],
      [20, 0, 0],
      [1.5, 0, 0],
    ] as const) {
      await expect(tiles.get(z, x, y)).rejects.toBeInstanceOf(TileError);
    }
    expect(upstream.hits).toEqual([]);
  });

  it("shares one upstream fetch between concurrent requests for a tile", async () => {
    const tiles = cache();
    await Promise.all([tiles.get(8, 3, 3), tiles.get(8, 3, 3), tiles.get(8, 3, 3)]);
    expect(upstream.hits).toEqual(["8/3/3"]);
  });

  it("keeps serving cached tiles after a restart, without asking upstream", async () => {
    await cache().get(9, 7, 7);
    const restarted = cache();
    expect((await restarted.get(9, 7, 7)).source).toBe("hit");
    expect(upstream.hits).toEqual(["9/7/7"]);
    expect(restarted.sizeBytes).toBeGreaterThan(0);
  });
});

describe("cacheTtl", () => {
  it("honours shorter max-age and no-store/no-cache", () => {
    expect(cacheTtl(null, 1000)).toBe(1000);
    expect(cacheTtl("public, max-age=5", 10_000)).toBe(5000);
    expect(cacheTtl("max-age=999999", 10_000)).toBe(10_000);
    expect(cacheTtl("no-store", 10_000)).toBe(0);
    expect(cacheTtl("no-cache", 10_000)).toBe(0);
  });
});

describe("GET /api/tiles/:z/:x/:y.png", () => {
  it("serves PNGs through the cache with 400/502 errors as JSON", async () => {
    const tiles = cache();
    const t = await startTestApp({ deps: { tiles } });
    try {
      const get = (url: string) => t.app.inject({ method: "GET", url });
      const first = await get("/api/tiles/14/2621/5718.png");
      expect(first.statusCode).toBe(200);
      expect(first.headers["content-type"]).toBe("image/png");
      expect(first.headers["x-tile-cache"]).toBe("miss");
      expect(first.rawPayload.equals(tilePng(14, 2621, 5718))).toBe(true);
      expect((await get("/api/tiles/14/2621/5718.png")).headers["x-tile-cache"]).toBe("hit");

      expect((await get("/api/tiles/2/9/9.png")).statusCode).toBe(400);
      expect((await get("/api/tiles/2/1/1.jpg")).statusCode).toBe(400);
      upstream.failWith = 500;
      const failed = await get("/api/tiles/3/1/1.png");
      expect(failed.statusCode).toBe(502);
      expect(failed.json()).toMatchObject({ error: "tile_unavailable" });
    } finally {
      await t.close();
    }
  });
});
