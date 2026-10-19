import { create, fromBinary, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import { Mesh } from "@meshtastic/protobufs";

export type FromRadio = Mesh.FromRadio;
export type ToRadio = Mesh.ToRadio;
export type FromRadioInit = MessageInitShape<typeof Mesh.FromRadioSchema>;
export type ToRadioInit = MessageInitShape<typeof Mesh.ToRadioSchema>;

export function encodeFromRadio(init: FromRadioInit): Uint8Array {
  return toBinary(Mesh.FromRadioSchema, create(Mesh.FromRadioSchema, init));
}

export function decodeFromRadio(bytes: Uint8Array): FromRadio {
  return fromBinary(Mesh.FromRadioSchema, bytes);
}

export function encodeToRadio(init: ToRadioInit): Uint8Array {
  return toBinary(Mesh.ToRadioSchema, create(Mesh.ToRadioSchema, init));
}

export function decodeToRadio(bytes: Uint8Array): ToRadio {
  return fromBinary(Mesh.ToRadioSchema, bytes);
}

/** The `payload_variant` oneof of a `FromRadio` under construction. */
export type FromRadioVariant = NonNullable<FromRadioInit["payloadVariant"]>;
