/** Meshtastic stream API framing: `0x94 0xC3 <len_hi> <len_lo> <protobuf bytes>`. */
export const START1 = 0x94;
export const START2 = 0xc3;
export const HEADER_LEN = 4;
/** Largest legal payload. A bigger length means we locked onto a false header. */
export const MAX_PAYLOAD_LEN = 512;

export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_PAYLOAD_LEN) {
    throw new RangeError(`frame payload ${payload.length} bytes exceeds ${MAX_PAYLOAD_LEN}`);
  }
  const frame = new Uint8Array(HEADER_LEN + payload.length);
  frame[0] = START1;
  frame[1] = START2;
  frame[2] = payload.length >> 8;
  frame[3] = payload.length & 0xff;
  frame.set(payload, HEADER_LEN);
  return frame;
}

/**
 * Turns an arbitrary byte stream into frame payloads. Handles frames split across
 * chunks, several frames per chunk, garbage before the magic, and resyncs when a
 * header's length is over {@link MAX_PAYLOAD_LEN}. Zero-length frames are dropped.
 */
export class StreamFramer {
  private buffer: Uint8Array = new Uint8Array(0);
  /** Bytes thrown away while hunting for a header. */
  discarded = 0;

  push(chunk: Uint8Array): Uint8Array[] {
    this.buffer = concat(this.buffer, chunk);
    const frames: Uint8Array[] = [];

    for (;;) {
      const start = this.findMagic();
      if (start > 0) this.drop(start);
      if (this.buffer.length < HEADER_LEN) break;

      const len = ((this.buffer[2] ?? 0) << 8) | (this.buffer[3] ?? 0);
      if (len > MAX_PAYLOAD_LEN) {
        // False header: skip its first byte and scan again.
        this.drop(1);
        continue;
      }
      if (this.buffer.length < HEADER_LEN + len) break;

      // A zero-length frame carries nothing; skip it.
      if (len > 0) frames.push(this.buffer.slice(HEADER_LEN, HEADER_LEN + len));
      this.buffer = this.buffer.subarray(HEADER_LEN + len);
    }
    return frames;
  }

  /**
   * Index of the first `START1 START2` pair. If none, the index to keep from: the
   * last byte when it is `START1` (its partner may be in the next chunk), else the end.
   */
  private findMagic(): number {
    const buf = this.buffer;
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === START1 && buf[i + 1] === START2) return i;
    }
    if (buf.length > 0 && buf[buf.length - 1] === START1) return buf.length - 1;
    return buf.length;
  }

  private drop(n: number): void {
    this.discarded += n;
    this.buffer = this.buffer.subarray(n);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
