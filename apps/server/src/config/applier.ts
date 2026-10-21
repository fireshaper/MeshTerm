import { randomUUID } from "node:crypto";
import {
  Admin,
  Channel,
  Config,
  create,
  fromJson,
  Mesh,
  ModuleConfig,
  toJson,
  type JsonValue,
} from "@meshterm/protocol";
import {
  ipv4FromUint32,
  SECRET_MASK,
  type ApplyBody,
  type ApplyStatusDTO,
  type ConfigMismatch,
  type ProtoJson,
} from "@meshterm/shared";
import type { Clock } from "../clock.js";
import type { NodeConnection } from "../connection/node-connection.js";
import type { Db } from "../db/database.js";
import type { Hub } from "../events/events.js";
import { silentLogger, type Logger } from "../logger.js";
import { HttpError } from "../routes/http-error.js";
import { AdminError, type AdminClient, type AdminVariant } from "./admin.js";
import { saveSnapshot } from "./snapshots.js";
import {
  configSectionJson,
  entryJson,
  isSecretPath,
  moduleSectionJson,
  versionOf,
  type ConfigEntry,
  type ConfigStore,
} from "./store.js";

/** Read-only sections: the firmware doesn't accept them in `set_config`. */
const READ_ONLY_SECTIONS = new Set(["sessionkey"]);
/** After a commit, a node that needs to reboot drops the link within this long. */
export const NO_REBOOT_GRACE_MS = 15_000;
/** No reconnect within this long after the reboot: show the recovery panel (CR-002 §5.3). */
export const RECOVERY_AFTER_MS = 3 * 60_000;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `patch` over `base`: objects merge, everything else (arrays included) replaces. */
export function deepMerge(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Leaf paths of a patch, e.g. `{ lora: { hopLimit: 4 } }` → `lora.hopLimit`. */
export function leafPaths(patch: Json, prefix: string): string[] {
  return Object.entries(patch).flatMap(([k, v]) =>
    isObject(v) && Object.keys(v).length > 0 ? leafPaths(v, `${prefix}.${k}`) : [`${prefix}.${k}`],
  );
}

/** Leaf paths where `next` differs from `base` (for whole messages, e.g. a channel). */
export function diffPaths(base: unknown, next: unknown, prefix: string): string[] {
  if (isObject(base) && isObject(next)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
    return [...keys].flatMap((k) => diffPaths(base[k], next[k], `${prefix}.${k}`));
  }
  return JSON.stringify(base) === JSON.stringify(next) ? [] : [prefix];
}

const at = (obj: unknown, path: string[]): unknown =>
  path.reduce<unknown>(
    (o, k) => (isObject(o) ? o[k] : Array.isArray(o) ? o[Number(k)] : undefined),
    obj,
  );

const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number"
    ? Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-6)
    : JSON.stringify(a) === JSON.stringify(b);

/** One admin message of the transaction, with what it should leave on the node. */
interface Step {
  variant: AdminVariant;
  /** Field paths it changes (never values). */
  paths: string[];
  /** What to re-read when the node doesn't reboot. */
  reread: AdminVariant & { expect: string };
}

interface Plan {
  steps: Step[];
  /** The whole intended config (proto JSON), to verify against. */
  intended: ReturnType<typeof entryJson>;
  paths: string[];
  /** A static IP the change gives the node: also tried after the reboot (CR-002 §7.1). */
  newHost: string | null;
}

/** The static IPv4 address a network section sets, if any. */
export function staticHostOf(network: ProtoJson | undefined): string | null {
  if (network?.addressMode !== "STATIC") return null;
  const ip = (network.ipv4Config as ProtoJson | undefined)?.ip;
  return typeof ip === "number" && ip !== 0 ? ipv4FromUint32(ip) : null;
}

const invalid = (what: string, err: unknown) =>
  new HttpError(
    400,
    "invalid_config",
    `${what}: ${err instanceof Error ? err.message : String(err)}`,
  );

/** Turns the requested changes into admin messages, validated against the protobuf schemas. */
export function planApply(entry: ConfigEntry, body: ApplyBody): Plan {
  const { changes } = body;
  const current = entryJson(entry);
  const intended = structuredClone(current);
  const steps: Step[] = [];
  const withExpect = (v: AdminVariant, expect: string) => ({ ...v, expect });

  if (changes.owner) {
    const merged = deepMerge(current.owner ?? {}, changes.owner);
    let user: Mesh.User;
    try {
      user = fromJson(Mesh.UserSchema, merged as JsonValue);
    } catch (err) {
      throw invalid("owner", err);
    }
    intended.owner = merged;
    steps.push({
      variant: { case: "setOwner", value: user },
      paths: leafPaths(changes.owner, "owner"),
      reread: withExpect({ case: "getOwnerRequest", value: true }, "getOwnerResponse"),
    });
  }

  for (const json of changes.channels ?? []) {
    let channel: Channel.Channel;
    try {
      channel = fromJson(Channel.ChannelSchema, json as JsonValue);
    } catch (err) {
      throw invalid("channel", err);
    }
    if (channel.index < 0 || channel.index > 7) throw invalid("channel", "index must be 0–7");
    const i = intended.channels.findIndex((c) => c.index === channel.index);
    const before = i >= 0 ? intended.channels[i] : {};
    // As the node would report it (all fields), so verify compares like with like.
    const full = toJson(Channel.ChannelSchema, channel, { alwaysEmitImplicit: true }) as ProtoJson;
    if (i >= 0) intended.channels[i] = full;
    else intended.channels.push(full);
    const changed = diffPaths(before, full, `channels.${channel.index}`);
    steps.push({
      variant: { case: "setChannel", value: channel },
      paths: changed,
      reread: withExpect(
        { case: "getChannelRequest", value: channel.index + 1 },
        "getChannelResponse",
      ),
    });
  }

  for (const [section, patch] of Object.entries(changes.config ?? {})) {
    const field = Config.ConfigSchema.fields.find((f) => f.localName === section);
    if (field?.fieldKind !== "message" || READ_ONLY_SECTIONS.has(section)) {
      throw invalid(`config.${section}`, "not a writable config section");
    }
    const base = entry.config.get(section);
    const merged = deepMerge(base ? configSectionJson(base) : {}, patch);
    let value;
    try {
      value = fromJson(field.message, merged as JsonValue);
    } catch (err) {
      throw invalid(`config.${section}`, err);
    }
    intended.config[section] = merged;
    const type =
      Admin.AdminMessage_ConfigType[
        `${section.toUpperCase()}_CONFIG` as keyof typeof Admin.AdminMessage_ConfigType
      ];
    steps.push({
      variant: {
        case: "setConfig",
        value: create(Config.ConfigSchema, { payloadVariant: { case: section, value } as never }),
      },
      paths: leafPaths(patch, `config.${section}`),
      reread: withExpect({ case: "getConfigRequest", value: type }, "getConfigResponse"),
    });
  }

  for (const [section, patch] of Object.entries(changes.moduleConfig ?? {})) {
    const field = ModuleConfig.ModuleConfigSchema.fields.find((f) => f.localName === section);
    if (field?.fieldKind !== "message")
      throw invalid(`moduleConfig.${section}`, "not a module section");
    const base = entry.moduleConfig.get(section);
    const merged = deepMerge(base ? moduleSectionJson(base) : {}, patch);
    let value;
    try {
      value = fromJson(field.message, merged as JsonValue);
    } catch (err) {
      throw invalid(`moduleConfig.${section}`, err);
    }
    intended.moduleConfig[section] = merged;
    steps.push({
      variant: {
        case: "setModuleConfig",
        value: create(ModuleConfig.ModuleConfigSchema, {
          payloadVariant: { case: section, value } as never,
        }),
      },
      paths: leafPaths(patch, `moduleConfig.${section}`),
      reread: withExpect(
        { case: "getModuleConfigRequest", value: moduleType(section) },
        "getModuleConfigResponse",
      ),
    });
  }

  if (changes.fixedPosition !== undefined) {
    const p = changes.fixedPosition;
    steps.push({
      variant: p
        ? {
            case: "setFixedPosition",
            value: create(Mesh.PositionSchema, {
              latitudeI: Math.round(p.lat * 1e7),
              longitudeI: Math.round(p.lon * 1e7),
              ...(p.alt === undefined ? {} : { altitude: p.alt }),
            }),
          }
        : { case: "removeFixedPosition", value: true },
      paths: ["fixedPosition"],
      reread: withExpect(
        { case: "getConfigRequest", value: Admin.AdminMessage_ConfigType.POSITION_CONFIG },
        "getConfigResponse",
      ),
    });
  }

  return {
    steps,
    intended,
    paths: steps.flatMap((s) => s.paths),
    newHost: changes.config?.network ? staticHostOf(intended.config.network) : null,
  };
}

/** `storeForward` → `STOREFORWARD_CONFIG` (the enum drops camelCase), with known exceptions. */
function moduleType(section: string): Admin.AdminMessage_ModuleConfigType {
  const special: Record<string, string> = {
    externalNotification: "EXTNOTIF_CONFIG",
    cannedMessage: "CANNEDMSG_CONFIG",
  };
  const name = special[section] ?? `${section.toUpperCase()}_CONFIG`;
  const value = (
    Admin.AdminMessage_ModuleConfigType as unknown as Record<
      string,
      Admin.AdminMessage_ModuleConfigType | undefined
    >
  )[name];
  if (value === undefined)
    throw invalid(`moduleConfig.${section}`, "the firmware can't be asked for it");
  return value;
}

/** Fields whose value on the node differs from what was sent (secrets masked). */
export function verify(
  intended: Plan["intended"],
  actual: Plan["intended"],
  paths: string[],
): ConfigMismatch[] {
  const mismatches: ConfigMismatch[] = [];
  for (const path of paths) {
    if (path === "fixedPosition") continue;
    const parts = path.split(".");
    // Channels are an array by position; find the channel by its index.
    const resolve = (data: Plan["intended"]) =>
      parts[0] === "channels"
        ? at(
            data.channels.find((c) => c.index === Number(parts[1])),
            parts.slice(2),
          )
        : at(data, parts);
    const sent = resolve(intended);
    const now = resolve(actual);
    if (!same(sent, now)) {
      const secret = isSecretPath(path.replace(/^channels\.\d+/, "channels.*"));
      mismatches.push({
        path,
        sent: secret ? SECRET_MASK : sent,
        actual: secret ? SECRET_MASK : now,
      });
    }
  }
  return mismatches;
}

export interface ApplierDeps {
  db: Db;
  hub: Hub;
  store: ConfigStore;
  connections: ReadonlyMap<number, NodeConnection>;
  admins: ReadonlyMap<number, AdminClient>;
  secretKey: Buffer;
  clock: Clock;
  logger?: Logger;
  noRebootGraceMs?: number;
  recoveryAfterMs?: number;
  /** Called once an apply ends (verified, mismatched, failed or recovery), e.g. for the audit log. */
  onFinish?: (status: ApplyStatusDTO) => void;
}

/**
 * Applies config changes to a node (CR-002 §5.3): one apply per node at a time.
 * Checks `baseVersion` (409 when the node changed meanwhile), snapshots the current
 * config, sends begin → sets (owner, channels, config, modules, position) → commit,
 * then waits for the reboot and reconnect (or re-reads when there's no reboot) and
 * verifies. Progress is published as `config.apply`.
 */
export class ConfigApplier {
  private readonly active = new Map<number, ApplyStatusDTO>();
  private readonly history = new Map<string, ApplyStatusDTO>();
  private readonly logger: Logger;

  constructor(private readonly deps: ApplierDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  status(applyId: string): ApplyStatusDTO | null {
    return this.history.get(applyId) ?? null;
  }

  /** The apply running on a connection, if any. */
  running(connectionId: number): ApplyStatusDTO | null {
    return this.active.get(connectionId) ?? null;
  }

  /** Validates, plans and starts an apply. Throws `HttpError` (404, 409, 400). */
  start(connectionId: number, by: string | null, body: ApplyBody): ApplyStatusDTO {
    const conn = this.deps.connections.get(connectionId);
    const admin = this.deps.admins.get(connectionId);
    const entry = this.deps.store.get(connectionId);
    if (!conn || !admin || !entry)
      throw new HttpError(404, "not_found", "no config for this connection");
    const running = this.active.get(connectionId);
    if (running) {
      throw new HttpError(
        409,
        "apply_in_progress",
        `an apply by ${running.by ?? "someone"} is in progress`,
      );
    }
    if (conn.state !== "connected")
      throw new HttpError(409, "not_connected", `the node is ${conn.state}`);
    if (versionOf(entry) !== body.baseVersion) {
      throw new HttpError(
        409,
        "conflict",
        "the node's config changed since you loaded it; reload and try again",
      );
    }
    const plan = planApply(entry, body);

    const status: ApplyStatusDTO = {
      applyId: randomUUID(),
      connectionId,
      phase: "applying",
      by,
      startedAt: this.deps.clock.now(),
      finishedAt: null,
      paths: plan.paths,
      mismatches: [],
      error: null,
      newHost: plan.newHost,
    };
    this.active.set(connectionId, status);
    this.remember(status);
    this.publish(status);
    void this.run(status, conn, admin, entry, plan);
    return status;
  }

  private async run(
    status: ApplyStatusDTO,
    conn: NodeConnection,
    admin: AdminClient,
    entry: ConfigEntry,
    plan: Plan,
  ): Promise<void> {
    const { clock } = this.deps;
    try {
      saveSnapshot(this.deps.db, this.deps.secretKey, {
        connectionId: status.connectionId,
        reason: "pre-apply",
        firmware: entry.firmware,
        data: entryJson(entry),
        now: clock.now(),
      });
      await admin.refreshPasskey();
      await admin.set({ case: "beginEditSettings", value: true });
      for (const step of plan.steps) await admin.set(step.variant);
      // A new static IP: after the reboot, try the old address and the new one.
      if (plan.newHost) conn.tryAlternateHost(plan.newHost);
      // Watch for the reboot before committing: the link may drop at once.
      const outcome = this.watchReboot(conn);
      await admin.set({ case: "commitEditSettings", value: true }).catch((err: unknown) => {
        // A reboot can cut the link before the commit's reply arrives; that's fine.
        if (!(err instanceof AdminError && err.code === "disconnected")) throw err;
      });
      const result = await outcome.wait((phase) => {
        this.update(status, { phase });
      });
      if (result === "recovery") {
        this.finish(status, {
          phase: "recovery",
          error: "the node didn't come back within 3 minutes",
        });
        return;
      }
      this.update(status, { phase: "verifying" });
      if (result === "no-reboot") await this.reread(status.connectionId, admin, plan);
      const now = this.deps.store.get(status.connectionId);
      const mismatches = now ? verify(plan.intended, entryJson(now), plan.paths) : [];
      this.finish(status, { phase: mismatches.length ? "mismatched" : "verified", mismatches });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ connectionId: status.connectionId, err: message }, "config apply failed");
      this.finish(status, { phase: "failed", error: message });
    }
  }

  /** Resolves with how the node took the commit: rebooted and came back, didn't reboot, or is gone. */
  private watchReboot(conn: NodeConnection) {
    const { clock } = this.deps;
    const grace = this.deps.noRebootGraceMs ?? NO_REBOOT_GRACE_MS;
    const recoveryAfter = this.deps.recoveryAfterMs ?? RECOVERY_AFTER_MS;
    let dropped = false;
    let onPhase: (phase: ApplyStatusDTO["phase"]) => void = () => undefined;
    let settle: (r: "rebooted" | "no-reboot" | "recovery") => void = () => undefined;
    const done = new Promise<"rebooted" | "no-reboot" | "recovery">((resolve) => {
      settle = resolve;
    });
    let cancelRecovery: (() => void) | null = null;
    const onState = ({ state }: { state: string }) => {
      if (state === "connected") {
        if (dropped) finish("rebooted");
        return;
      }
      if (!dropped) {
        dropped = true;
        cancelGrace();
        onPhase("rebooting");
        cancelRecovery = clock.setTimer(recoveryAfter, () => {
          finish("recovery");
        });
      } else if (state === "reconnecting" || state === "connecting" || state === "configuring") {
        onPhase("reconnecting");
      }
    };
    const finish = (r: "rebooted" | "no-reboot" | "recovery") => {
      conn.off("state", onState);
      cancelGrace();
      cancelRecovery?.();
      settle(r);
    };
    conn.on("state", onState);
    let cancelGrace: () => void = () => undefined;
    return {
      wait: (phase: typeof onPhase) => {
        onPhase = phase;
        if (!dropped) {
          cancelGrace = clock.setTimer(grace, () => {
            if (!dropped) finish("no-reboot");
          });
        }
        return done;
      },
    };
  }

  /** No reboot: ask the node for each changed section so verify compares fresh values. */
  private async reread(connectionId: number, admin: AdminClient, plan: Plan): Promise<void> {
    const seen = new Set<string>();
    for (const step of plan.steps) {
      const { expect, ...variant } = step.reread;
      const key = JSON.stringify(variant);
      if (seen.has(key)) continue;
      seen.add(key);
      const response = await admin.get(variant, expect as never);
      applyAdminResponse(this.deps.store, connectionId, response);
    }
  }

  private update(status: ApplyStatusDTO, patch: Partial<ApplyStatusDTO>): void {
    Object.assign(status, patch);
    this.publish(status);
  }

  private finish(status: ApplyStatusDTO, patch: Partial<ApplyStatusDTO>): void {
    Object.assign(status, patch, { finishedAt: this.deps.clock.now() });
    this.active.delete(status.connectionId);
    this.publish(status);
    this.deps.onFinish?.({ ...status });
  }

  private publish(status: ApplyStatusDTO): void {
    this.deps.hub.publish("config.apply", { status: { ...status } });
  }

  private remember(status: ApplyStatusDTO): void {
    this.history.set(status.applyId, status);
    // Keep the last 50.
    while (this.history.size > 50) {
      const oldest = this.history.keys().next().value;
      if (oldest === undefined) break;
      this.history.delete(oldest);
    }
  }
}

/** Folds an admin get response into the store (one section, channel or the owner). */
export function applyAdminResponse(
  store: ConfigStore,
  connectionId: number,
  response: Admin.AdminMessage,
): void {
  const v = response.payloadVariant;
  store.update(connectionId, (e) => {
    switch (v.case) {
      case "getConfigResponse":
        if (v.value.payloadVariant.case) e.config.set(v.value.payloadVariant.case, v.value);
        break;
      case "getModuleConfigResponse":
        if (v.value.payloadVariant.case) e.moduleConfig.set(v.value.payloadVariant.case, v.value);
        break;
      case "getChannelResponse":
        e.channels.set(v.value.index, v.value);
        break;
      case "getOwnerResponse":
        e.owner = v.value;
        break;
      default:
        break;
    }
  });
}
