import { create, Mesh, Portnums, toBinary } from "@meshterm/protocol";
import { describe, expect, it } from "vitest";
import { decodeFromRadio, packetPort, type DecodeContext } from "./decoder.js";

const RIDGE = 0x0badcafe;
const ctx: DecodeContext = { connectionId: 1, now: 1_800_000_000_000, newId: () => "id" };

function packet(portnum: Portnums.PortNum, payload: Uint8Array): Mesh.MeshPacket {
  return create(Mesh.MeshPacketSchema, {
    from: RIDGE,
    to: 0xffffffff,
    payloadVariant: { case: "decoded", value: { portnum, payload } },
  });
}

describe("NeighborInfo decoding", () => {
  it("lists the reported neighbors with SNR, dropping empty and self entries", () => {
    const info = create(Mesh.NeighborInfoSchema, {
      nodeId: RIDGE,
      neighbors: [
        { nodeId: 0x1a2b3c4d, snr: -2.25 },
        { nodeId: 0, snr: 1 },
        { nodeId: RIDGE, snr: 9 },
        { nodeId: 0x5e6f7081, snr: 4.123456 },
      ],
    });
    const result = decodeFromRadio(
      create(Mesh.FromRadioSchema, {
        payloadVariant: {
          case: "packet",
          value: packet(Portnums.PortNum.NEIGHBORINFO_APP, toBinary(Mesh.NeighborInfoSchema, info)),
        },
      }),
      ctx,
    );
    expect(result.events).toEqual([
      {
        type: "radio.neighbors",
        payload: {
          connectionId: 1,
          reporter: RIDGE,
          time: ctx.now,
          neighbors: [
            { num: 0x1a2b3c4d, snr: -2.25 },
            { num: 0x5e6f7081, snr: 4.12 },
          ],
        },
      },
    ]);
  });
});

describe("packetPort", () => {
  it("names decoded ports and marks undecodable packets", () => {
    expect(packetPort(packet(Portnums.PortNum.TEXT_MESSAGE_APP, new Uint8Array()))).toBe(
      "TEXT_MESSAGE_APP",
    );
    // A port number newer than our protobufs.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment
    expect(packetPort(packet(999 as Portnums.PortNum, new Uint8Array()))).toBe("PORT_999");
    expect(
      packetPort(
        create(Mesh.MeshPacketSchema, {
          from: RIDGE,
          payloadVariant: { case: "encrypted", value: new Uint8Array([1, 2, 3]) },
        }),
      ),
    ).toBe("ENCRYPTED");
  });
});
