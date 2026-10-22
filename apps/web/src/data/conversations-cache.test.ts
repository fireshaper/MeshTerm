import { fixtures, type ConversationsDTO, type Message } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import {
  applyMessageToConversations,
  applyStatusToConversations,
  toPreview,
  applyReadToConversations,
  applyStateToConversations,
  badgeText,
  unreadTotals,
} from "./conversations-cache.js";

const RIDGE = 0x0badcafe;
const TRAIL = 0x1a2b3c4d;
const msg = (over: Partial<Message>): Message => ({ ...fixtures.inboundMessage, ...over });

function dto(): ConversationsDTO {
  return {
    channels: [
      {
        index: 0,
        name: "LongFast",
        role: "PRIMARY",
        encryption: "default",
        lastMessage: null,
        unread: 0,
        state: { lastReadRxTime: 0, muted: false, favorite: false },
      },
    ],
    dms: [
      {
        peer: TRAIL,
        lastMessage: toPreview(msg({ id: "00000000-0000-4000-8000-000000000001", rxTime: 5_000 })),
        unread: 0,
        state: { lastReadRxTime: 0, muted: false, favorite: false },
        ignored: false,
      },
    ],
  };
}

describe("conversation list cache", () => {
  it("a channel message becomes the channel's preview; an older one doesn't, but is unread", () => {
    const m = msg({ id: "00000000-0000-4000-8000-000000000002", peer: null, rxTime: 9_000 });
    const next = applyMessageToConversations(dto(), m);
    expect(next.channels[0]?.lastMessage?.id).toBe(m.id);
    expect(next.channels[0]?.unread).toBe(1);
    const older = msg({ id: "00000000-0000-4000-8000-000000000003", peer: null, rxTime: 1 });
    const after = applyMessageToConversations(next, older);
    expect(after.channels[0]?.lastMessage?.id).toBe(m.id);
    expect(after.channels[0]?.unread).toBe(2);
    // An old message that was already read changes nothing.
    const read = applyReadToConversations(after, "channel", 0, 9_000).data;
    expect(applyMessageToConversations(read, older)).toBe(read);
  });

  it("counts unread: not our own, reactions or ignored nodes", () => {
    const own = msg({ peer: TRAIL, direction: "out", rxTime: 9_000 });
    expect(applyMessageToConversations(dto(), own).dms[0]?.unread).toBe(0);
    const reaction = msg({ peer: TRAIL, emoji: true, rxTime: 9_000 });
    expect(applyMessageToConversations(dto(), reaction).dms[0]?.unread).toBe(0);
    const ignored = msg({ peer: RIDGE, fromNum: RIDGE, rxTime: 9_000 });
    const next = applyMessageToConversations(dto(), ignored, new Set([RIDGE]));
    expect(next.dms[0]).toMatchObject({ peer: RIDGE, unread: 0, ignored: true });
  });

  it("read marks clear counts; part-way reads ask for a refetch", () => {
    let d = applyMessageToConversations(dto(), msg({ peer: TRAIL, rxTime: 9_000 }));
    d = applyMessageToConversations(
      d,
      msg({ id: "00000000-0000-4000-8000-000000000009", peer: TRAIL, rxTime: 9_500 }),
    );
    expect(d.dms[0]?.unread).toBe(2);
    const part = applyReadToConversations(d, "dm", TRAIL, 9_000);
    expect(part.stale).toBe(true);
    const all = applyReadToConversations(d, "dm", TRAIL, 9_500);
    expect(all).toMatchObject({ stale: false });
    expect(all.data.dms[0]).toMatchObject({ unread: 0, state: { lastReadRxTime: 9_500 } });
  });

  it("totals leave out muted and ignored conversations and flag DMs", () => {
    let d = applyMessageToConversations(dto(), msg({ peer: null, rxTime: 9_000 }));
    expect(unreadTotals(d)).toEqual({ total: 1, dm: false });
    d = applyMessageToConversations(d, msg({ peer: TRAIL, rxTime: 9_000 }));
    expect(unreadTotals(d)).toEqual({ total: 2, dm: true });
    d = applyStateToConversations(d, "dm", TRAIL, {
      lastReadRxTime: 0,
      muted: true,
      favorite: false,
    });
    expect(unreadTotals(d)).toEqual({ total: 1, dm: false });
    expect(badgeText(100)).toBe("99+");
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
