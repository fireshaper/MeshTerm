import { Channel, Config, Mesh, ModuleConfig } from "@meshterm/protocol";
import type { ConfigSchemaDTO, FieldSchema } from "@meshterm/shared";

/** `ScalarType` numbers from @bufbuild/protobuf (proto field type ids). */
const SCALAR: Record<number, FieldSchema["kind"]> = {
  1: "float", // double
  2: "float",
  3: "int64",
  4: "int64", // uint64
  5: "int",
  6: "int64", // fixed64
  7: "uint", // fixed32
  8: "bool",
  9: "string",
  12: "bytes",
  13: "uint",
  15: "int", // sfixed32
  16: "int64", // sfixed64
  17: "int", // sint32
  18: "int64", // sint64
};

interface DescFieldLike {
  jsonName: string;
  fieldKind: string;
  scalar?: number;
  listKind?: string;
  enum?: { values: readonly { name: string }[] };
  message?: { fields: readonly unknown[] };
}

/** Enum value names without their type prefix are what proto JSON uses; protobuf-es already strips it. */
function describe(f: DescFieldLike, depth: number): FieldSchema {
  const list = f.fieldKind === "list";
  const kindOf = (): Pick<FieldSchema, "kind" | "enumValues" | "fields"> => {
    if (f.enum) return { kind: "enum", enumValues: f.enum.values.map((v) => v.name) };
    if (f.message) {
      return {
        kind: "message",
        // Deeply nested messages are rare in config; past 3 levels they're left as raw JSON.
        ...(depth < 3 ? { fields: fieldsOf(f.message, depth + 1) } : {}),
      };
    }
    return { kind: SCALAR[f.scalar ?? 9] ?? "string" };
  };
  return { name: f.jsonName, list, ...kindOf() };
}

function fieldsOf(message: { fields: readonly unknown[] }, depth = 0): FieldSchema[] {
  return (message.fields as DescFieldLike[]).map((f) => describe(f, depth));
}

function sections(oneof: { fields: readonly unknown[] }): Record<string, FieldSchema[]> {
  const out: Record<string, FieldSchema[]> = {};
  for (const f of oneof.fields as (DescFieldLike & { localName: string })[]) {
    if (f.message) out[f.localName] = fieldsOf(f.message, 1);
  }
  return out;
}

let cached: ConfigSchemaDTO | null = null;

/** Every editable message's fields, by reflection on the pinned protobufs (computed once). */
export function configSchema(): ConfigSchemaDTO {
  cached ??= {
    owner: fieldsOf(Mesh.UserSchema),
    config: sections(Config.ConfigSchema),
    moduleConfig: sections(ModuleConfig.ModuleConfigSchema),
    channel: fieldsOf(Channel.ChannelSchema),
  };
  return cached;
}
