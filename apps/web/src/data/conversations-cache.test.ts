import { fixtures, type ConversationsDTO, type Message } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import {
  applyMessageToConversations,
  applyStatusToConversations,
  toPreview,
} from "./conversations-cache.js";

const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;
const msg = (over: Partial<Message>): Message => ({ ...fixtures.inboundMessage, ...over });

function dto(): ConversationsDTO {
  return {
    channels: [
      { index: 0, name: "LongFast", role: "PRIMARY", encryption: "default", lastMessage: null },
    ],
    dms: [
      {
        peer: TRAIL,
        lastMessage: toPreview(msg({ id: "00000000-0000-4000-8000-000000000001", rxTime: 5_000 })),
      },
    ],
  };
}

describe("conversation list cache", () => {
  it("a channel message becomes the channel's preview; an older one doesn't", () => {
    const m = msg({ id: "00000000-0000-4000-8000-000000000002", peer: null, rxTime: 9_000 });
    const next = applyMessageToConversations(dto(), m);
    expect(next.channels[0]?.lastMessage?.id).toBe(m.id);
    const older = msg({ id: "00000000-0000-4000-8000-000000000003", peer: null, rxTime: 1 });
    expect(applyMessageToConversations(next, older)).toBe(next);
  });

  it("a DM from a new peer adds a row on top; a message on another channel is ignored", () => {
    const m = msg({ id: "00000000-0000-4000-8000-000000000004", peer: RIDGE, rxTime: 9_000 });
    const next = applyMessageToConversations(dto(), m);
    expect(next.dms.map((d) => d.peer)).toEqual([RIDGE, TRAIL]);
    const elsewhere = msg({ peer: null, channelIndex: 5 });
    expect(applyMessageToConversations(next, elsewhere)).toBe(next);
  });

  it("a newer DM moves its peer to the top", () => {
    let data = applyMessageToConversations(
      dto(),
      msg({ id: "00000000-0000-4000-8000-000000000005", peer: RIDGE, rxTime: 6_000 }),
    );
    data = applyMessageToConversations(
      data,
      msg({ id: "00000000-0000-4000-8000-000000000006", peer: TRAIL, rxTime: 7_000 }),
    );
    expect(data.dms.map((d) => d.peer)).toEqual([TRAIL, RIDGE]);
  });

  it("message.status updates the preview of that message only", () => {
    const out = msg({
      id: "00000000-0000-4000-8000-000000000007",
      peer: RIDGE,
      rxTime: 9_000,
      direction: "out",
      status: "sent",
    });
    const data = applyMessageToConversations(dto(), out);
    const acked = applyStatusToConversations(data, out.id, "acked");
    expect(acked.dms[0]?.lastMessage.status).toBe("acked");
    expect(
      applyStatusToConversations(acked, "ffffffff-ffff-4fff-8fff-ffffffffffff", "failed"),
    ).toBe(acked);
  });
});
