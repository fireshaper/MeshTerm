import { FakeNode, RawClient } from "@meshterm/fake-node";
import { create, Mesh, Portnums, toBinary, type FromRadio } from "@meshterm/protocol";

export const ME = 0xa1b2c3d4;
export const RIDGE = 0x0badcafe;
export const NEWCOMER = 0x77777777;
export const RECORDED_AT_MS = 1_800_000_000_000;

/** Real frames captured from a FakeNode session, one per case the decoder handles. */
export interface RecordedFrames {
  handshake: FromRadio[];
  channelText: FromRadio;
  dmText: FromRadio;
  nodeInfoPacket: FromRadio;
  ack: FromRadio;
  nak: FromRadio;
  telemetry: FromRadio;
}

const isPortPacket = (m: FromRadio, port: Portnums.PortNum) =>
  m.payloadVariant.case === "packet" &&
  m.payloadVariant.value.payloadVariant.case === "decoded" &&
  m.payloadVariant.value.payloadVariant.value.portnum === port;

function textPacketTo(id: number, to: number) {
  return {
    payloadVariant: {
      case: "packet" as const,
      value: {
        id,
        to,
        wantAck: true,
        payloadVariant: {
          case: "decoded" as const,
          value: {
            portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
            payload: new TextEncoder().encode("x"),
          },
        },
      },
    },
  };
}

/** Runs a FakeNode, drives each case over a raw socket and returns the frames received. */
export async function recordFrames(): Promise<RecordedFrames> {
  const node = new FakeNode({ now: () => RECORDED_AT_MS });
  await node.start();
  const client = await RawClient.open(node.port);
  try {
    const next = async (act: () => void): Promise<FromRadio> => {
      const count = client.received.length;
      act();
      await client.waitFor((r) => r.length > count);
      return client.received[count] as FromRadio;
    };
    /** Like `next`, but for a reply that follows a queueStatus. */
    const routingReply = async (act: () => void): Promise<FromRadio> => {
      const count = client.received.length;
      act();
      await client.waitFor((r) =>
        r.slice(count).some((m) => isPortPacket(m, Portnums.PortNum.ROUTING_APP)),
      );
      return client.received
        .slice(count)
        .find((m) => isPortPacket(m, Portnums.PortNum.ROUTING_APP)) as FromRadio;
    };

    client.send({ payloadVariant: { case: "wantConfigId", value: 1 } });
    await client.waitFor((r) => r.at(-1)?.payloadVariant.case === "configCompleteId");
    const handshake = [...client.received];

    const channelText = await next(() => node.injectText(RIDGE, { channel: 1 }, "hello channel"));
    const dmText = await next(() =>
      node.injectText(RIDGE, { to: ME }, "hello dm", { hopsAway: 1, rxSnr: -2.5, rxRssi: -101 }),
    );
    const nodeInfoPacket = await next(() =>
      node.injectNodeInfo({
        num: NEWCOMER,
        user: {
          id: "!77777777",
          longName: "Newcomer",
          shortName: "NEW",
          hwModel: Mesh.HardwareModel.TBEAM,
        },
        snr: 4,
        hopsAway: 2,
      }),
    );
    node.setAckMode("ack");
    const ack = await routingReply(() => {
      client.send(textPacketTo(0x1111, RIDGE));
    });
    node.setAckMode("nak");
    const nak = await routingReply(() => {
      client.send(textPacketTo(0x2222, RIDGE));
    });
    const telemetry = await next(() => {
      node.sendFromRadio({
        case: "packet",
        value: {
          from: RIDGE,
          to: 0xffff_ffff,
          id: 0x3333,
          rxTime: RECORDED_AT_MS / 1000,
          payloadVariant: {
            case: "decoded",
            value: {
              portnum: Portnums.PortNum.TELEMETRY_APP,
              payload: toBinary(Mesh.DataSchema, create(Mesh.DataSchema)),
            },
          },
        },
      });
    });
    return { handshake, channelText, dmText, nodeInfoPacket, ack, nak, telemetry };
  } finally {
    client.close();
    await node.stop();
  }
}
