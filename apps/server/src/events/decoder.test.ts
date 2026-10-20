import { beforeAll, describe, expect, it } from "vitest";
import { decodeFromRadio, nodeHeard, type DecodeContext } from "./decoder.js";
import type { RadioEvent } from "./events.js";
import {
  ME,
  NEWCOMER,
  RECORDED_AT_MS,
  recordFrames,
  RIDGE,
  type RecordedFrames,
} from "./recorded.js";

const NOW = 1_900_000_000_000;
const ID = "5f0c5a4e-8d63-4c3e-9a1b-2c3d4e5f6a7b";
const ctx: DecodeContext = { connectionId: 1, now: NOW, newId: () => ID };

let frames: RecordedFrames;

beforeAll(async () => {
  frames = await recordFrames();
});

const decode = (m: Parameters<typeof decodeFromRadio>[0]) => decodeFromRadio(m, ctx);
const only = (events: RadioEvent[]) => {
  expect(events).toHaveLength(1);
  return events[0];
};

describe("decodeFromRadio", () => {
  it("my_info becomes radio.myInfo", () => {
    const myInfo = frames.handshake.find((m) => m.payloadVariant.case === "myInfo");
    expect(only(decode(myInfo ?? frames.unhandled).events)).toEqual({
      type: "radio.myInfo",
      payload: { connectionId: 1, myNodeNum: ME },
    });
  });

  it("node_info becomes a full node update", () => {
    const ridge = frames.handshake.find(
      (m) => m.payloadVariant.case === "nodeInfo" && m.payloadVariant.value.num === RIDGE,
    );
    expect(only(decode(ridge ?? frames.unhandled).events)).toEqual({
      type: "radio.node",
      payload: {
        connectionId: 1,
        update: {
          num: RIDGE,
          longName: "Ridge Repeater",
          shortName: "RDG",
          hwModel: "RAK4631",
          role: "ROUTER",
          lastHeard: RECORDED_AT_MS - 45_000,
          snr: 7.25,
          hopsAway: 0,
          isFavorite: false,
          isIgnored: false,
          hasPublicKey: true,
          publicKey: "0b30557a9fc4e90e33587da2c7ec11365b80a5caef14395e83a8cdf2173c6186",
        },
      },
    });
  });

  it("channels become channel upserts without the PSK", () => {
    const channels = frames.handshake.filter((m) => m.payloadVariant.case === "channel");
    const events = channels.flatMap((m) => decode(m).events);
    expect(events).toEqual([
      {
        type: "radio.channel",
        payload: {
          channel: { connectionId: 1, index: 0, name: "", role: "PRIMARY", encryption: "default" },
        },
      },
      {
        type: "radio.channel",
        payload: {
          channel: {
            connectionId: 1,
            index: 1,
            name: "Friends",
            role: "SECONDARY",
            encryption: "custom",
          },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/psk/i);
  });

  it("a broadcast text is an inbound channel message", () => {
    const event = only(decode(frames.channelText).events);
    expect(event?.type).toBe("radio.text");
    if (event?.type !== "radio.text") return;
    expect(event.payload.message).toMatchObject({
      id: ID,
      connectionId: 1,
      fromNum: RIDGE,
      toNum: 0xffff_ffff,
      peer: null,
      channelIndex: 1,
      text: "hello channel",
      rxTime: RECORDED_AT_MS,
      direction: "in",
      status: null,
      rxSnr: 6.25,
      rxRssi: -72,
    });
  });

  it("a text to my node is a DM with the sender as peer", () => {
    const event = only(decode(frames.dmText).events);
    if (event?.type !== "radio.text") throw new Error("expected radio.text");
    expect(event.payload.message).toMatchObject({
      fromNum: RIDGE,
      toNum: ME,
      peer: RIDGE,
      text: "hello dm",
      rxSnr: -2.5,
      rxRssi: -101,
    });
  });

  it("a NODEINFO_APP packet becomes a node update from the User", () => {
    expect(only(decode(frames.nodeInfoPacket).events)).toEqual({
      type: "radio.node",
      payload: {
        connectionId: 1,
        update: {
          num: NEWCOMER,
          longName: "Newcomer",
          shortName: "NEW",
          hwModel: "TBEAM",
          role: "CLIENT",
          hasPublicKey: false,
          publicKey: null,
        },
      },
    });
  });

  it("a routing ACK becomes acked for its request id", () => {
    expect(only(decode(frames.ack).events)).toEqual({
      type: "radio.routing",
      payload: {
        connectionId: 1,
        from: expect.any(Number) as unknown,
        requestId: 0x1111,
        status: "acked",
        error: null,
      },
    });
  });

  it("a routing error becomes failed with the error name", () => {
    expect(only(decode(frames.nak).events)).toEqual({
      type: "radio.routing",
      payload: {
        connectionId: 1,
        from: expect.any(Number) as unknown,
        requestId: 0x2222,
        status: "failed",
        error: "MAX_RETRANSMIT",
      },
    });
  });

  it("an unhandled port yields no events and says why", () => {
    expect(decode(frames.unhandled)).toEqual({ events: [], ignored: "port RANGE_TEST_APP" });
  });

  it("the LoRa config yields the modem preset, metadata the firmware; other config nothing", () => {
    const lora: RadioEvent[] = [];
    const meta = frames.handshake.find((m) => m.payloadVariant.case === "metadata");
    expect(decode(meta ?? frames.unhandled).events).toEqual([
      {
        type: "radio.metadata",
        payload: { connectionId: 1, firmware: expect.any(String) as unknown },
      },
    ]);
    for (const m of frames.handshake) {
      const v = m.payloadVariant;
      if (v.case === "config" && v.value.payloadVariant.case === "lora") {
        lora.push(...decode(m).events);
        continue;
      }
      const c = v.case;
      if (c === "config" || c === "moduleConfig" || c === "configCompleteId") {
        expect(decode(m).events).toEqual([]);
      }
    }
    expect(lora).toEqual([
      { type: "radio.lora", payload: { connectionId: 1, modemPreset: "LONG_FAST", hopLimit: 3 } },
    ]);
  });
});

describe("nodeHeard", () => {
  it("marks the sender of any packet as heard, with signal and hops", () => {
    expect(nodeHeard(frames.dmText, ctx)).toEqual({
      type: "radio.node",
      payload: {
        connectionId: 1,
        update: {
          num: RIDGE,
          lastHeard: RECORDED_AT_MS,
          snr: -2.5,
          rssi: -101,
          hopsAway: 1,
          viaMqtt: false,
        },
      },
    });
  });

  it("applies to packets the decoder ignores", () => {
    const heard = nodeHeard(frames.unhandled, ctx);
    expect(heard?.payload).toMatchObject({ update: { num: RIDGE, lastHeard: RECORDED_AT_MS } });
  });

  it("ignores non-packets", () => {
    expect(nodeHeard(frames.handshake[0] ?? frames.unhandled, ctx)).toBeNull();
  });
});
