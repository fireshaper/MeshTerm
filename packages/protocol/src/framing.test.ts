import { describe, expect, it } from "vitest";
import { encodeFrame, MAX_PAYLOAD_LEN, StreamFramer } from "./framing.js";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("encodeFrame", () => {
  it("writes the magic and a big-endian length", () => {
    const payload = new Uint8Array(300).fill(7);
    const frame = encodeFrame(payload);
    expect([...frame.subarray(0, 4)]).toEqual([0x94, 0xc3, 0x01, 0x2c]);
    expect(frame.length).toBe(304);
  });

  it("rejects payloads over the limit", () => {
    expect(() => encodeFrame(new Uint8Array(MAX_PAYLOAD_LEN + 1))).toThrow(RangeError);
  });
});

describe("StreamFramer", () => {
  it("reassembles a frame split across chunks", () => {
    const f = new StreamFramer();
    const frame = encodeFrame(bytes(1, 2, 3, 4, 5));
    expect(f.push(frame.subarray(0, 1))).toEqual([]);
    expect(f.push(frame.subarray(1, 6))).toEqual([]);
    expect(f.push(frame.subarray(6))).toEqual([bytes(1, 2, 3, 4, 5)]);
  });

  it("returns several frames from one chunk", () => {
    const f = new StreamFramer();
    const chunk = new Uint8Array([...encodeFrame(bytes(1)), ...encodeFrame(bytes(2, 2))]);
    expect(f.push(chunk)).toEqual([bytes(1), bytes(2, 2)]);
  });

  it("skips garbage before the magic, including a lone START1", () => {
    const f = new StreamFramer();
    const chunk = new Uint8Array([0x00, 0x94, 0x41, 0xc3, ...encodeFrame(bytes(9))]);
    expect(f.push(chunk)).toEqual([bytes(9)]);
    expect(f.discarded).toBe(4);
  });

  it("resyncs past a header whose length is over 512", () => {
    const f = new StreamFramer();
    const chunk = new Uint8Array([0x94, 0xc3, 0xff, 0xff, ...encodeFrame(bytes(3))]);
    expect(f.push(chunk)).toEqual([bytes(3)]);
  });

  it("delivers a valid frame that follows a header claiming 600 bytes", () => {
    const f = new StreamFramer();
    const chunk = new Uint8Array([0x94, 0xc3, 0x02, 0x58, 0x01, 0x02, ...encodeFrame(bytes(4, 4))]);
    expect(f.push(chunk)).toEqual([bytes(4, 4)]);
  });

  it("ignores a zero-length frame", () => {
    const f = new StreamFramer();
    const chunk = new Uint8Array([...encodeFrame(bytes()), ...encodeFrame(bytes(8))]);
    expect(f.push(chunk)).toEqual([bytes(8)]);
  });
});
