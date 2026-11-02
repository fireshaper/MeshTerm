import { fixtures, type MeshNode, type Message } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import {
  byteMeterState,
  continuesGroup,
  firstUnreadIndex,
  GROUP_GAP_MS,
  heardThisHour,
  hopsTaken,
  messagePath,
} from "./thread.js";

const T = Date.UTC(2026, 10, 1, 12, 0);
const msg = (over: Partial<Message>): Message => ({
  ...fixtures.inboundMessage,
  rxTime: T,
  ...over,
});

describe("continuesGroup", () => {
  const first = msg({ fromNum: 1 });
  it("groups the same sender, same side, close in time", () => {
    expect(continuesGroup(first, msg({ fromNum: 1, rxTime: T + 60_000 }))).toBe(true);
    expect(continuesGroup(first, msg({ fromNum: 1, rxTime: T + GROUP_GAP_MS }))).toBe(true);
  });
  it("starts a new group for another sender, a long gap, a new day or a reaction", () => {
    expect(continuesGroup(undefined, first)).toBe(false);
    expect(continuesGroup(first, msg({ fromNum: 2, rxTime: T + 1000 }))).toBe(false);
    expect(continuesGroup(first, msg({ fromNum: 1, rxTime: T + GROUP_GAP_MS + 1 }))).toBe(false);
    expect(continuesGroup(first, msg({ fromNum: 1, direction: "out", rxTime: T + 1 }))).toBe(false);
    expect(continuesGroup(first, msg({ fromNum: 1, emoji: true, rxTime: T + 1 }))).toBe(false);
    const lateNight = msg({ fromNum: 1, rxTime: new Date(2026, 10, 1, 23, 58).getTime() });
    const pastMidnight = msg({ fromNum: 1, rxTime: new Date(2026, 10, 2, 0, 1).getTime() });
    expect(continuesGroup(lateNight, pastMidnight)).toBe(false);
  });
});

describe("hops and the message path", () => {
  it("hops are hop_start − hop_limit, unknown when the firmware didn't say", () => {
    expect(hopsTaken({ hopStart: 3, hopLimit: 3 })).toBe(0);
    expect(hopsTaken({ hopStart: 3, hopLimit: 1 })).toBe(2);
    expect(hopsTaken({ hopStart: null, hopLimit: 3 })).toBeNull();
    expect(hopsTaken({ hopStart: 0, hopLimit: 0 })).toBeNull();
    expect(hopsTaken({ hopStart: 2, hopLimit: 5 })).toBeNull();
  });

  const origin = { lat: 47.6, lon: -122.3 };
  const near = { lat: 47.64, lon: -122.3 };
  it("direct: distance, direct and SNR", () => {
    expect(messagePath(msg({ hopStart: 3, hopLimit: 3, rxSnr: 7.25 }), origin, near)).toBe(
      "4.4 km · direct · 7.25 dB",
    );
  });
  it("relayed: hops without SNR (it would be the last relay's)", () => {
    expect(messagePath(msg({ hopStart: 3, hopLimit: 1, rxSnr: -4 }), origin, near)).toBe(
      "4.4 km · 2 hops",
    );
    expect(messagePath(msg({ hopStart: 3, hopLimit: 2 }), null, near)).toBe("1 hop");
  });
  it("MQTT says so; nothing known is null", () => {
    expect(messagePath(msg({ viaMqtt: true, hopStart: 3, hopLimit: 3 }), null, null)).toBe(
      "via MQTT",
    );
    expect(messagePath(msg({ hopStart: null, hopLimit: null }), origin, null)).toBeNull();
  });
});

describe("byteMeterState", () => {
  it.each([
    [0, "ok"],
    [170, "ok"],
    [171, "near"],
    [200, "near"],
    [201, "over"],
  ] as const)("%i bytes → %s", (bytes, state) => {
    expect(byteMeterState(bytes)).toBe(state);
  });
});

describe("firstUnreadIndex", () => {
  const messages = [
    msg({ rxTime: T, direction: "in" }),
    msg({ rxTime: T + 1, direction: "out" }),
    msg({ rxTime: T + 2, direction: "in", emoji: true }),
    msg({ rxTime: T + 3, direction: "in" }),
  ];
  it("is the first incoming non-reaction after the mark", () => {
    expect(firstUnreadIndex(messages, T)).toBe(3);
    expect(firstUnreadIndex(messages, T - 1)).toBe(0);
  });
  it("is -1 when all is read or the mark isn't known yet", () => {
    expect(firstUnreadIndex(messages, T + 3)).toBe(-1);
    expect(firstUnreadIndex(messages, null)).toBe(-1);
  });
});

describe("heardThisHour", () => {
  const node = (num: number, lastHeard: number | null): MeshNode => ({
    ...fixtures.node,
    num,
    lastHeard,
  });
  it("others heard within the hour, most recent first", () => {
    const now = T;
    const heard = heardThisHour(
      [node(1, now - 60_000), node(2, now - 10_000), node(3, now - 2 * 3600_000), node(9, now)],
      now,
      9,
    );
    expect(heard.map((n) => n.num)).toEqual([2, 1]);
  });
});
