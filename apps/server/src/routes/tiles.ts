import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { TileError, type TileCache } from "../tiles/tile-cache.js";
import { HttpError } from "./http-error.js";

const TileParams = z.object({
  z: z.coerce.number().int(),
  x: z.coerce.number().int(),
  file: z.string().regex(/^\d+\.png$/, "expected <y>.png"),
});

/**
 * `GET /api/tiles/:z/:x/:y.png` (street map) and `GET /api/tiles/topo/:z/:x/:y.png`
 * (topographic) through the server's tile caches.
 */
export function tileRoutes(tiles: TileCache, topo: TileCache): FastifyPluginAsyncZod {
  return (app) => {
    for (const [prefix, cache] of [
      ["/api/tiles", tiles],
      ["/api/tiles/topo", topo],
    ] as const) {
      app.get(`${prefix}/:z/:x/:file`, { schema: { params: TileParams } }, async (req, reply) => {
        const { z: zoom, x, file } = req.params;
        try {
          const tile = await cache.get(zoom, x, Number.parseInt(file, 10));
          return await reply
            .header("content-type", tile.contentType)
            .header("cache-control", "public, max-age=604800")
            .header("x-tile-cache", tile.source)
            .send(tile.body);
        } catch (err) {
          if (err instanceof TileError) {
            throw new HttpError(
              err.status,
              err.status === 400 ? "bad_request" : "tile_unavailable",
              err.message,
            );
          }
          throw err;
        }
      });
    }
    return Promise.resolve();
  };
}
