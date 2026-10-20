import { z } from "zod";
import { CardPosition, NodeCard } from "./dashboard.js";
import { EpochMs, TelemetryKind, TelemetryMetrics } from "./domain.js";

/** The newest stored report of one telemetry kind: every numeric field it carried. */
export const LatestTelemetry = z.object({ time: EpochMs, metrics: TelemetryMetrics });
export type LatestTelemetry = z.infer<typeof LatestTelemetry>;

/** `GET /api/connections/:id/nodes/:num`: everything known about one node. */
export const NodeDetailDTO = NodeCard.extend({
  /** When MeshTerm first stored this node. */
  firstSeen: EpochMs.nullable(),
  /** Only known for our own node (from the handshake). */
  firmware: z.string().nullable(),
  /** First 8 bytes of its PKI public key, hex; null without a key. */
  publicKeyFingerprint: z.string().nullable(),
  /** The full public key (hex), for copying. */
  publicKey: z.string().nullable(),
  /** The last packet from it came through MQTT. */
  viaMqtt: z.boolean(),
  isIgnored: z.boolean(),
  /** Newest report per kind (all fields), for the Overview and Raw tabs. */
  latestTelemetry: z.partialRecord(TelemetryKind, LatestTelemetry),
  stats24h: z.object({
    packets: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    /** Battery range over 24 h, ignoring "external power" readings (> 100). */
    batteryMin: z.number().nullable(),
    batteryMax: z.number().nullable(),
  }),
  /** My node's position, for distance and bearing; null for my node or without a fix. */
  origin: CardPosition.nullable(),
  /** Kinds this node has ever reported, in `TELEMETRY_KINDS` order. */
  telemetryKinds: z.array(TelemetryKind),
});
export type NodeDetailDTO = z.infer<typeof NodeDetailDTO>;

/** One metric over time; `min`/`max` only for bucketed series. */
export const Series = z.object({
  avg: z.array(z.number().nullable()),
  min: z.array(z.number().nullable()).optional(),
  max: z.array(z.number().nullable()).optional(),
});
export type Series = z.infer<typeof Series>;

/**
 * `GET …/nodes/:num/telemetry` and `…/signal`. `t` is epoch ms (bucket start); every
 * series has one entry per `t`. `bucketMs` 0 means raw samples.
 */
export const SeriesDTO = z.object({
  kind: z.string(),
  from: EpochMs,
  to: EpochMs,
  bucketMs: z.number().int().nonnegative(),
  t: z.array(EpochMs),
  series: z.record(z.string(), Series),
});
export type SeriesDTO = z.infer<typeof SeriesDTO>;

/** `GET …/nodes/:num/signal`: SNR/RSSI/hops series plus packet counts per `rate.bucketMs`. */
export const SignalDTO = SeriesDTO.extend({
  rate: z.object({
    bucketMs: z.number().int().positive(),
    t: z.array(EpochMs),
    packets: z.array(z.number().int().nonnegative()),
  }),
});
export type SignalDTO = z.infer<typeof SignalDTO>;

/** At most this many points per series; wider buckets are used when a range would exceed it. */
export const SERIES_MAX_POINTS = 1_000;
/** Signal history (`signal_log`) is kept this long. */
export const SIGNAL_RETENTION_MS = 7 * 24 * 3600_000;

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The bucket for a time range (CR-001 §6.2): raw up to 2 h, 5 min up to 36 h,
 * 30 min up to 8 d, else 2 h; widened so a series never exceeds `SERIES_MAX_POINTS`.
 */
export function bucketFor(spanMs: number): number {
  const base =
    spanMs <= 2 * HOUR
      ? 0
      : spanMs <= 36 * HOUR
        ? 5 * MIN
        : spanMs <= 8 * 24 * HOUR
          ? 30 * MIN
          : 2 * HOUR;
  if (base === 0) return 0;
  const minimum = Math.ceil(spanMs / SERIES_MAX_POINTS / MIN) * MIN;
  return Math.max(base, minimum);
}

/** Packet-rate bars: 5 min up to 2 h, hourly up to 8 d, else 6 h. */
export function rateBucketFor(spanMs: number): number {
  return spanMs <= 2 * HOUR ? 5 * MIN : spanMs <= 8 * 24 * HOUR ? HOUR : 6 * HOUR;
}

/** `ab12cd34ef567890` from a 64-hex-digit public key. */
export function keyFingerprint(publicKeyHex: string | null): string | null {
  return publicKeyHex && /^[0-9a-f]{64}$/.test(publicKeyHex) ? publicKeyHex.slice(0, 16) : null;
}
