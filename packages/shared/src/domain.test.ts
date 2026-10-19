import { describe, expect, it } from "vitest";
import {
  Channel,
  Connection,
  ConnectionState,
  MeshNode,
  Message,
  MessageStatus,
  nodeIdFromNum,
  utf8ByteLength,
} from "./domain.js";
import { fixtures } from "./fixtures.js";

describe("domain schemas", () => {
  it.each([
    ["Connection", Connection, fixtures.connection],
    ["MeshNode", MeshNode, fixtures.node],
    ["Channel", Channel, fixtures.channel],
    ["Message (in)", Message, fixtures.inboundMessage],
    ["Message (out)", Message, fixtures.outboundMessage],
  ] as const)("parses a valid %s fixture", (_name, schema, fixture) => {
    expect(schema.parse(fixture)).toEqual(fixture);
  });

  it("accepts every connection state and status", () => {
    for (const state of [
      "disconnected",
      "connecting",
      "configuring",
      "connected",
      "reconnecting",
    ]) {
      expect(ConnectionState.parse(state)).toBe(state);
    }
    for (const status of ["queued", "sent", "acked", "failed"]) {
      expect(MessageStatus.parse(status)).toBe(status);
    }
  });

  it("rejects an invalid message status", () => {
    expect(MessageStatus.safeParse("delivered").success).toBe(false);
    expect(Message.safeParse({ ...fixtures.outboundMessage, status: "delivered" }).success).toBe(
      false,
    );
  });

  it("rejects channel index 8", () => {
    expect(Channel.safeParse({ ...fixtures.channel, index: 8 }).success).toBe(false);
    expect(Message.safeParse({ ...fixtures.inboundMessage, channelIndex: 8 }).success).toBe(false);
  });

  it("strips a psk key from a channel", () => {
    const parsed = Channel.parse({ ...fixtures.channel, psk: "AQ==" });
    expect(parsed).not.toHaveProperty("psk");
    expect(parsed).toEqual(fixtures.channel);
  });

  it("rejects a malformed node id and out-of-range node number", () => {
    expect(MeshNode.safeParse({ ...fixtures.node, id: "a1b2c3d4" }).success).toBe(false);
    expect(MeshNode.safeParse({ ...fixtures.node, num: 2 ** 32 }).success).toBe(false);
  });

  it("requires connectionId on every persisted type", () => {
    const { connectionId: _n, ...node } = fixtures.node;
    const { connectionId: _c, ...channel } = fixtures.channel;
    const { connectionId: _m, ...message } = fixtures.inboundMessage;
    expect(MeshNode.safeParse(node).success).toBe(false);
    expect(Channel.safeParse(channel).success).toBe(false);
    expect(Message.safeParse(message).success).toBe(false);
  });
});

describe("helpers", () => {
  it("formats node ids as !<8 hex>", () => {
    expect(nodeIdFromNum(0xa1b2c3d4)).toBe("!a1b2c3d4");
    expect(nodeIdFromNum(0x1)).toBe("!00000001");
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(utf8ByteLength("hello")).toBe(5);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("📡")).toBe(4);
  });
});
