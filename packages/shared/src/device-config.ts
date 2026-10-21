import { z } from "zod";
import { ConnectionId, EpochMs } from "./domain.js";

/** A protobuf message as proto3 JSON (lowerCamelCase fields, enum names, base64 bytes). */
export const ProtoJson = z.record(z.string(), z.unknown());
export type ProtoJson = z.infer<typeof ProtoJson>;

/** What viewers see instead of a secret (PSKs, Wi-Fi password, private key, MQTT password). */
export const SECRET_MASK = "••••••••";

/**
 * `GET /api/connections/:id/config` (CR-002 §8.2): everything the node reported, as
 * proto JSON. Sections are keyed by their oneof case (`device`, `lora`, `mqtt`, …).
 */
export const DeviceConfigDTO = z.object({
  connectionId: ConnectionId,
  /** Hash of the whole config: `baseVersion` for an apply, to detect changes made meanwhile. */
  version: z.string(),
  /** When the config was last read from the node. */
  receivedAt: EpochMs,
  myNodeNum: z.number().int().nonnegative(),
  firmware: z.string().nullable(),
  /** Our node's `User` (long/short name, licensed, …). */
  owner: ProtoJson.nullable(),
  /** `Config` sections: each value is the section message (e.g. `Config.LoRaConfig`). */
  config: z.record(z.string(), ProtoJson),
  /** `ModuleConfig` sections. */
  moduleConfig: z.record(z.string(), ProtoJson),
  /** `Channel` messages, index order. */
  channels: z.array(ProtoJson),
  /** Secrets were replaced with `SECRET_MASK` (viewers). */
  secretsMasked: z.boolean(),
});
export type DeviceConfigDTO = z.infer<typeof DeviceConfigDTO>;

/** A fixed position for `set_fixed_position` (degrees, metres). */
export const FixedPosition = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number().int().min(-1000).max(10_000).optional(),
});
export type FixedPosition = z.infer<typeof FixedPosition>;

/**
 * `POST …/config/apply` body. Sections are partial proto JSON merged onto the node's
 * current section; channels are whole `Channel` messages (by `index`).
 */
export const ConfigChanges = z
  .object({
    owner: ProtoJson.optional(),
    config: z.record(z.string(), ProtoJson).optional(),
    moduleConfig: z.record(z.string(), ProtoJson).optional(),
    channels: z.array(ProtoJson).max(8).optional(),
    /** A position to fix, or null to remove the fixed position. */
    fixedPosition: FixedPosition.nullable().optional(),
  })
  .refine(
    (c) =>
      c.owner !== undefined ||
      Object.keys(c.config ?? {}).length > 0 ||
      Object.keys(c.moduleConfig ?? {}).length > 0 ||
      (c.channels?.length ?? 0) > 0 ||
      c.fixedPosition !== undefined,
    { message: "nothing to apply" },
  );
export type ConfigChanges = z.infer<typeof ConfigChanges>;

export const ApplyBody = z.object({ baseVersion: z.string(), changes: ConfigChanges });
export type ApplyBody = z.infer<typeof ApplyBody>;

/**
 * Where an apply is (CR-002 §5.3): `applying` (begin → sets → commit), `rebooting` (the
 * node dropped the link), `reconnecting`, `verifying` (re-reading and comparing), then
 * `verified` / `mismatched`, `failed`, or `recovery` (no reconnect within 3 minutes).
 */
export const ApplyPhase = z.enum([
  "applying",
  "rebooting",
  "reconnecting",
  "verifying",
  "verified",
  "mismatched",
  "failed",
  "recovery",
]);
export type ApplyPhase = z.infer<typeof ApplyPhase>;

/** A field whose value on the node isn't what was sent (firmware may clamp or ignore it). */
export const ConfigMismatch = z.object({
  /** e.g. `config.lora.txPower`, `channels.1.settings.name`. */
  path: z.string(),
  /** Secrets are masked. */
  sent: z.unknown(),
  actual: z.unknown(),
});
export type ConfigMismatch = z.infer<typeof ConfigMismatch>;

export const ApplyStatusDTO = z.object({
  applyId: z.string(),
  connectionId: ConnectionId,
  phase: ApplyPhase,
  by: z.string().nullable(),
  startedAt: EpochMs,
  finishedAt: EpochMs.nullable(),
  /** Field paths that were changed (never values). */
  paths: z.array(z.string()),
  mismatches: z.array(ConfigMismatch),
  error: z.string().nullable(),
});
export type ApplyStatusDTO = z.infer<typeof ApplyStatusDTO>;

export const ConfigSnapshotSummary = z.object({
  id: z.number().int().positive(),
  takenAt: EpochMs,
  reason: z.enum(["pre-apply", "pre-maintenance", "manual"]),
  firmware: z.string().nullable(),
});
export type ConfigSnapshotSummary = z.infer<typeof ConfigSnapshotSummary>;
