import { createHash } from "node:crypto";
import { Channel, Config, Mesh, ModuleConfig, toJson, type JsonValue } from "@meshterm/protocol";
import { SECRET_MASK, type DeviceConfigDTO, type ProtoJson } from "@meshterm/shared";
import type { NodeConnection } from "../connection/node-connection.js";
import type { Hub } from "../events/events.js";

/** Everything the editor works on for one node, as protobuf messages (secrets included). */
export interface ConfigEntry {
  myNodeNum: number;
  firmware: string | null;
  owner: Mesh.User | null;
  /** By oneof case. */
  config: Map<string, Config.Config>;
  moduleConfig: Map<string, ModuleConfig.ModuleConfig>;
  /** By channel index. */
  channels: Map<number, Channel.Channel>;
  receivedAt: number;
}

/**
 * Secret fields (proto JSON paths; `*` = any channel). Masked for viewers and in
 * diffs, logs and audit entries; never written to the database unencrypted.
 */
export const SECRET_PATHS = [
  "config.network.wifiPsk",
  "config.security.privateKey",
  "moduleConfig.mqtt.password",
  "channels.*.settings.psk",
] as const;

export function isSecretPath(path: string): boolean {
  return SECRET_PATHS.some((p) => {
    const a = p.split(".");
    const b = path.split(".");
    return a.length === b.length && a.every((part, i) => part === "*" || part === b[i]);
  });
}

const json = (v: JsonValue): ProtoJson => (v ?? {}) as ProtoJson;
const OPTS = { alwaysEmitImplicit: true } as const;

/** The section message inside a `Config` (e.g. its `LoRaConfig`) as proto JSON. */
export function configSectionJson(c: Config.Config): ProtoJson {
  const v = c.payloadVariant;
  const field = v.case ? Config.ConfigSchema.field[v.case] : undefined;
  if (!v.case || field?.fieldKind !== "message") return {};
  return json(toJson(field.message, v.value as never, OPTS));
}

export function moduleSectionJson(c: ModuleConfig.ModuleConfig): ProtoJson {
  const v = c.payloadVariant;
  const field = v.case ? ModuleConfig.ModuleConfigSchema.field[v.case] : undefined;
  if (!v.case || field?.fieldKind !== "message") return {};
  return json(toJson(field.message, v.value as never, OPTS));
}

/** The whole config as plain JSON (secrets included): what the version hashes and verify compares. */
export function entryJson(e: ConfigEntry) {
  const byKey = <T>(m: Map<string, T>, f: (v: T) => ProtoJson) =>
    Object.fromEntries(
      [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, f(v)]),
    );
  return {
    owner: e.owner ? json(toJson(Mesh.UserSchema, e.owner, OPTS)) : null,
    config: byKey(e.config, configSectionJson),
    moduleConfig: byKey(e.moduleConfig, moduleSectionJson),
    channels: [...e.channels.values()]
      .sort((a, b) => a.index - b.index)
      .map((c) => json(toJson(Channel.ChannelSchema, c, OPTS))),
  };
}

export function versionOf(e: ConfigEntry): string {
  return createHash("sha256")
    .update(JSON.stringify(entryJson(e)))
    .digest("hex")
    .slice(0, 16);
}

/** Replaces every secret with `SECRET_MASK` (empty secrets stay empty: nothing to hide). */
export function maskSecrets<T extends ReturnType<typeof entryJson>>(data: T): T {
  const copy = structuredClone(data);
  const mask = (obj: ProtoJson | undefined, key: string) => {
    if (obj && typeof obj[key] === "string" && obj[key] !== "") obj[key] = SECRET_MASK;
  };
  mask(copy.config.network, "wifiPsk");
  mask(copy.config.security, "privateKey");
  mask(copy.moduleConfig.mqtt, "password");
  for (const ch of copy.channels) mask(ch.settings as ProtoJson | undefined, "psk");
  return copy;
}

/**
 * The live config of every connection, from the last handshake plus admin responses
 * since. Kept in memory only (it holds PSKs and keys). Publishes `config.updated`.
 */
export class ConfigStore {
  private readonly entries = new Map<number, ConfigEntry>();

  constructor(
    private readonly hub: Hub,
    private readonly now: () => number,
  ) {}

  /** Follows a connection: every completed handshake replaces its entry. */
  attach(conn: NodeConnection): void {
    conn.on("state", ({ state }) => {
      if (state === "connected") this.fromHandshake(conn);
    });
  }

  fromHandshake(conn: NodeConnection): void {
    const m = conn.model;
    if (m.myNodeNum === null) return;
    this.set(conn.connection.id, {
      myNodeNum: m.myNodeNum,
      firmware: m.metadata?.firmwareVersion || null,
      owner: m.nodes.get(m.myNodeNum)?.user ?? null,
      config: new Map(m.config),
      moduleConfig: new Map(m.moduleConfig),
      channels: new Map(m.channels),
      receivedAt: this.now(),
    });
  }

  get(connectionId: number): ConfigEntry | null {
    return this.entries.get(connectionId) ?? null;
  }

  /** Applies what an admin get response told us (one section, channel or the owner). */
  update(connectionId: number, change: (entry: ConfigEntry) => void): void {
    const entry = this.entries.get(connectionId);
    if (!entry) return;
    const next: ConfigEntry = {
      ...entry,
      config: new Map(entry.config),
      moduleConfig: new Map(entry.moduleConfig),
      channels: new Map(entry.channels),
      receivedAt: this.now(),
    };
    change(next);
    this.set(connectionId, next);
  }

  dto(connectionId: number, options: { masked: boolean }): DeviceConfigDTO | null {
    const e = this.entries.get(connectionId);
    if (!e) return null;
    const data = entryJson(e);
    return {
      connectionId,
      version: versionOf(e),
      receivedAt: e.receivedAt,
      myNodeNum: e.myNodeNum,
      firmware: e.firmware,
      ...(options.masked ? maskSecrets(data) : data),
      secretsMasked: options.masked,
    };
  }

  private set(connectionId: number, entry: ConfigEntry): void {
    const before = this.entries.get(connectionId);
    this.entries.set(connectionId, entry);
    const version = versionOf(entry);
    if (!before || versionOf(before) !== version) {
      this.hub.publish("config.updated", { connectionId, version });
    }
  }
}
