import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.js";
import { ClientMessage, ServerMessage } from "./ws.js";

const serverMessages: ServerMessage[] = [
  {
    type: "snapshot",
    connectionId: 1,
    state: "connected",
    myNodeNum: fixtures.node.num,
    nodes: [fixtures.node],
    channels: [fixtures.channel],
    channelMessages: [{ channelIndex: 0, messages: [fixtures.outboundMessage] }],
    dmMessages: [{ peer: 0x0badcafe, messages: [fixtures.inboundMessage] }],
  },
  {
    type: "connection.state",
    connectionId: 1,
    state: "reconnecting",
    previous: "connected",
    reason: "socket closed",
  },
  { type: "node.upsert", node: fixtures.node },
  { type: "message.new", message: fixtures.inboundMessage },
  {
    type: "message.status",
    connectionId: 1,
    messageId: fixtures.outboundMessage.id,
    status: "acked",
  },
  { type: "error", code: "invalid_message", message: "Expected a subscribe message" },
];

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("WebSocket protocol", () => {
  it.each(serverMessages.map((m) => [m.type, m] as const))(
    "round-trips %s through JSON unchanged",
    (_type, message) => {
      expect(ServerMessage.parse(roundTrip(message))).toEqual(message);
    },
  );

  it("round-trips subscribe", () => {
    const message: ClientMessage = { type: "subscribe", connectionId: 1 };
    expect(ClientMessage.parse(roundTrip(message))).toEqual(message);
  });

  it("rejects an unknown type", () => {
    expect(ServerMessage.safeParse({ type: "telemetry.new" }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "unsubscribe", connectionId: 1 }).success).toBe(false);
  });

  it("rejects message.status without a message id", () => {
    expect(
      ServerMessage.safeParse({ type: "message.status", connectionId: 1, status: "acked" }).success,
    ).toBe(false);
  });

  it("rejects subscribe without a valid connection id", () => {
    expect(ClientMessage.safeParse({ type: "subscribe" }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "subscribe", connectionId: 0 }).success).toBe(false);
  });

  it("strips psk from channels inside a snapshot", () => {
    const snapshot = { ...serverMessages[0], channels: [{ ...fixtures.channel, psk: "AQ==" }] };
    expect(JSON.stringify(ServerMessage.parse(snapshot))).not.toMatch(/psk/i);
  });
});
