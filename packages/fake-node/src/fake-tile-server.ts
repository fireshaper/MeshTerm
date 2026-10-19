import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crc32, deflateSync } from "node:zlib";

/**
 * A stand-in for a slippy-map tile server (`/{z}/{x}/{y}.png`), for tests. Serves
 * deterministic 256×256 PNGs (a muted tint per tile plus grid lines), counts hits,
 * and can be told to fail or send particular cache headers.
 */
export class FakeTileServer {
  private server: Server | null = null;
  /** Requests received, as `z/x/y`. */
  readonly hits: string[] = [];
  /** `Cache-Control` sent with tiles; null sends none. */
  cacheControl: string | null = "max-age=604800";
  /** Answer every request with this status instead of a tile. */
  failWith: number | null = null;
  port = 0;

  get urlTemplate(): string {
    return `http://127.0.0.1:${this.port}/{z}/{x}/{y}.png`;
  }

  async start(port = 0): Promise<number> {
    const server = createServer((req, res) => {
      const match = /^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(req.url ?? "");
      if (!match) {
        res.writeHead(404).end();
        return;
      }
      const [, z, x, y] = match.map(Number) as [number, number, number, number];
      this.hits.push(`${z}/${x}/${y}`);
      if (this.failWith !== null) {
        res.writeHead(this.failWith).end();
        return;
      }
      res.writeHead(200, {
        "content-type": "image/png",
        ...(this.cacheControl ? { "cache-control": this.cacheControl } : {}),
      });
      res.end(tilePng(z, x, y));
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    this.port = (server.address() as AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

/** A 256×256 tile: a light tint chosen from the coordinates, with a grid every 32 px. */
export function tilePng(z: number, x: number, y: number): Buffer {
  const tint = [(x * 37 + z * 11) % 40, (y * 53 + z * 7) % 40, ((x + y) * 29) % 40];
  return encodePng(256, 256, (px, py) => {
    const line = px % 32 === 0 || py % 32 === 0;
    const base = line ? 200 : 232;
    return [base - (tint[0] ?? 0), base - (tint[1] ?? 0), base - (tint[2] ?? 0)];
  });
}

/** Minimal truecolor PNG encoder (8-bit RGB, no filtering). */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let i = 0;
  for (let y = 0; y < height; y++) {
    raw[i++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[i++] = r;
      raw[i++] = g;
      raw[i++] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);
  return Buffer.concat([length, typeAndData, crc]);
}
