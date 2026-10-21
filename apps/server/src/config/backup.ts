import {
  Channel,
  Config,
  fromJson,
  ModuleConfig,
  toJson,
  type JsonValue,
} from "@meshterm/protocol";
import type { FixedPosition, ImportedConfigDTO, ProtoJson } from "@meshterm/shared";
import { parse, stringify } from "yaml";
import { ChannelUrlError, encodeChannelUrl, parseChannelUrl } from "./channel-url.js";
import type { ConfigEntry } from "./store.js";

/**
 * Backup as YAML in the Meshtastic CLI's `--export-config` layout (CR-002 §5.7):
 * `owner`, `owner_short`, `channel_url`, `location`, `config.<section>` and
 * `module_config.<section>` with snake_case fields, non-default values only, enum names,
 * and bytes as `base64:<…>`. Reading takes snake_case or camelCase.
 */

const BYTES = 12; // ScalarType.BYTES

type SectionSchema = (typeof Config.ConfigSchema.fields)[number];

interface MessageDesc {
  fields: readonly {
    name: string;
    jsonName: string;
    fieldKind: string;
    scalar?: number;
    message?: MessageDesc;
  }[];
}

function sectionMessage(
  schema: typeof Config.ConfigSchema | typeof ModuleConfig.ModuleConfigSchema,
  section: string,
): MessageDesc | null {
  const field = (schema.fields as readonly SectionSchema[]).find(
    (f) => f.localName === section || f.name === section,
  );
  return field?.fieldKind === "message" ? (field.message as unknown as MessageDesc) : null;
}

const isBytes = (f: MessageDesc["fields"][number]) =>
  (f.fieldKind === "scalar" || f.fieldKind === "list") && f.scalar === BYTES;

/** `base64:` on bytes fields, as the CLI writes them. */
function prefixBytes(desc: MessageDesc, obj: ProtoJson): ProtoJson {
  for (const f of desc.fields) {
    const v = obj[f.name];
    if (!isBytes(f) || v === undefined) continue;
    const tag = (x: unknown) => `base64:${typeof x === "string" ? x : ""}`;
    obj[f.name] = Array.isArray(v) ? v.map(tag) : tag(v);
  }
  return obj;
}

const SECRET_FIELDS: Record<string, string[]> = {
  "config.network": ["wifi_psk"],
  "config.security": ["private_key"],
  "module_config.mqtt": ["password"],
};

export interface ExportOptions {
  secrets: boolean;
  /** The node's position when it has a fixed one. */
  location: FixedPosition | null;
}

export function exportYaml(entry: ConfigEntry, options: ExportOptions): string {
  const out: Record<string, unknown> = {};
  if (options.secrets) {
    const enabled = [...entry.channels.values()]
      .filter((c) => c.role !== Channel.Channel_Role.DISABLED && c.settings)
      .sort(
        (a, b) =>
          (a.role === Channel.Channel_Role.PRIMARY ? 0 : 1) -
            (b.role === Channel.Channel_Role.PRIMARY ? 0 : 1) || a.index - b.index,
      );
    const lora = entry.config.get("lora")?.payloadVariant;
    if (enabled.length > 0) {
      out.channel_url = encodeChannelUrl(
        enabled.flatMap((c) => (c.settings ? [c.settings] : [])),
        lora?.case === "lora" ? lora.value : null,
      );
    }
  }
  const sections = (
    kind: "config" | "module_config",
    map: Map<string, Config.Config | ModuleConfig.ModuleConfig>,
  ) => {
    const result: Record<string, ProtoJson> = {};
    for (const [, message] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const v = message.payloadVariant;
      if (!v.case) continue;
      const schema = kind === "config" ? Config.ConfigSchema : ModuleConfig.ModuleConfigSchema;
      const field = (schema.fields as readonly SectionSchema[]).find((f) => f.localName === v.case);
      if (field?.fieldKind !== "message") continue;
      const obj = (toJson(field.message, v.value as never, { useProtoFieldName: true }) ??
        {}) as ProtoJson;
      prefixBytes(field.message as unknown as MessageDesc, obj);
      const hide = options.secrets ? [] : (SECRET_FIELDS[`${kind}.${field.name}`] ?? []);
      result[field.name] = Object.fromEntries(
        Object.entries(obj).filter(([k]) => !hide.includes(k)),
      );
    }
    return result;
  };
  out.config = sections("config", entry.config);
  if (options.location) {
    out.location = {
      lat: options.location.lat,
      lon: options.location.lon,
      ...(options.location.alt === undefined ? {} : { alt: options.location.alt }),
    };
  }
  out.module_config = sections("module_config", entry.moduleConfig);
  if (entry.owner) {
    out.owner = entry.owner.longName;
    out.owner_short = entry.owner.shortName;
  }
  const header = options.secrets
    ? "# start of Meshtastic configure yaml\n# Contains secrets (channel keys, Wi-Fi password, private key): keep it safe.\n"
    : "# start of Meshtastic configure yaml\n# Secrets excluded: channel_url (keys), Wi-Fi password, private key, MQTT password.\n";
  return header + stringify(out, { lineWidth: 0 });
}

export class BackupError extends Error {}

const snakeToCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Drops unknown keys (recording them) and the `base64:` prefixes, so `fromJson` accepts it. */
function clean(desc: MessageDesc, obj: unknown, at: string, unknown: string[]): JsonValue {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return obj as JsonValue;
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const field = desc.fields.find((f) => f.name === key || f.jsonName === key);
    if (!field) {
      unknown.push(`${at}.${key}`);
      continue;
    }
    const strip = (x: unknown) =>
      typeof x === "string" && x.startsWith("base64:") ? x.slice("base64:".length) : x;
    let v: unknown = isBytes(field)
      ? Array.isArray(value)
        ? value.map(strip)
        : strip(value)
      : value;
    if (field.fieldKind === "message" && field.message) {
      v = clean(field.message, v, `${at}.${field.jsonName}`, unknown);
    }
    out[field.jsonName] = v as JsonValue;
  }
  return out;
}

function readSections(
  kind: "config" | "moduleConfig",
  raw: unknown,
  unknown: string[],
): Record<string, ProtoJson> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new BackupError(`${kind} isn't a map`);
  const schema = kind === "config" ? Config.ConfigSchema : ModuleConfig.ModuleConfigSchema;
  const out: Record<string, ProtoJson> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const section = snakeToCamel(name);
    const desc = sectionMessage(schema, section);
    const field = (schema.fields as readonly SectionSchema[]).find(
      (f) => f.localName === section || f.name === name,
    );
    if (!desc || !field || field.fieldKind !== "message") {
      unknown.push(`${kind}.${name}`);
      continue;
    }
    const cleaned = clean(desc, value ?? {}, `${kind}.${field.localName}`, unknown);
    try {
      const message = fromJson(field.message, cleaned);
      out[field.localName] = (toJson(field.message, message, { alwaysEmitImplicit: true }) ??
        {}) as ProtoJson;
    } catch (err) {
      throw new BackupError(`${kind}.${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

const KNOWN_TOP = new Set([
  "owner",
  "owner_short",
  "ownerShort",
  "channel_url",
  "channelUrl",
  "location",
  "config",
  "module_config",
  "moduleConfig",
]);

/** Reads a backup into what it would set; nothing is applied (CR-002 §5.7). */
export function importYaml(text: string): ImportedConfigDTO {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    throw new BackupError(`not YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new BackupError("not a Meshtastic config file");
  }
  const d = doc as Record<string, unknown>;
  const unknown = Object.keys(d).filter((k) => !KNOWN_TOP.has(k));
  const owner: ProtoJson = {};
  if (typeof d.owner === "string") owner.longName = d.owner;
  const short = d.owner_short ?? d.ownerShort;
  if (typeof short === "string") owner.shortName = short;

  let channels = null;
  const url = d.channel_url ?? d.channelUrl;
  if (typeof url === "string" && url !== "") {
    try {
      channels = parseChannelUrl(url);
    } catch (err) {
      if (err instanceof ChannelUrlError) throw new BackupError(`channel_url: ${err.message}`);
      throw err;
    }
  }
  let fixedPosition: FixedPosition | null = null;
  if (d.location && typeof d.location === "object") {
    const { lat, lon, alt } = d.location as Record<string, unknown>;
    if (typeof lat === "number" && typeof lon === "number") {
      fixedPosition = { lat, lon, ...(typeof alt === "number" ? { alt: Math.round(alt) } : {}) };
    }
  }
  return {
    owner: Object.keys(owner).length > 0 ? owner : null,
    config: readSections("config", d.config, unknown),
    moduleConfig: readSections("moduleConfig", d.module_config ?? d.moduleConfig, unknown),
    channels,
    fixedPosition,
    unknown,
  };
}

/** `meshterm-<short name>-<YYYY-MM-DD>.yaml` (CR-002 §5.7). */
export function backupFileName(shortName: string, now: number): string {
  const safe = shortName.replace(/[^A-Za-z0-9_-]/g, "") || "node";
  return `meshterm-${safe}-${new Date(now).toISOString().slice(0, 10)}.yaml`;
}
