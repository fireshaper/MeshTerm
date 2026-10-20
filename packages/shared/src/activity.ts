import { z } from "zod";
import { ConnectionId, EpochMs, Uint32 } from "./domain.js";

/** Notable events for the activity feed (not every packet). */
export const ActivityKind = z.enum([
  /** A text message was received (`messageId`, `detail` = preview). */
  "message.in",
  /** We sent a text message (`messageId`, `detail` = preview). */
  "message.out",
  /** A node appeared in the node DB while connected. */
  "node.new",
  /** A node was heard again after being quiet longer than the stale threshold (`value` = quiet ms). */
  "node.back",
  /** A node's power state changed, e.g. battery → low (`detail` = "from→to", `value` = level). */
  "power.changed",
  /** The link to my node dropped (`detail` = reason). */
  "connection.lost",
  /** The link came back (`value` = downtime ms). */
  "connection.restored",
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const ActivityEvent = z.object({
  id: z.number().int().positive(),
  connectionId: ConnectionId,
  time: EpochMs,
  kind: ActivityKind,
  nodeNum: Uint32.nullable(),
  messageId: z.string().nullable(),
  value: z.number().nullable(),
  detail: z.string().nullable(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

/** `GET /api/connections/:id/events`: newest first. */
export const ActivityPage = z.object({
  events: z.array(ActivityEvent),
  /** Pass as `before` for older events; null when there are none. */
  nextBefore: z.number().int().positive().nullable(),
});
export type ActivityPage = z.infer<typeof ActivityPage>;

export const TRAFFIC_WINDOWS = ["1h", "6h", "24h", "7d"] as const;
export const TrafficWindow = z.enum(TRAFFIC_WINDOWS);
export type TrafficWindow = z.infer<typeof TrafficWindow>;

/** Window length and bucket size for each traffic window. */
export const TRAFFIC_BUCKETS: Record<TrafficWindow, { spanMs: number; bucketMs: number }> = {
  "1h": { spanMs: 3600_000, bucketMs: 5 * 60_000 },
  "6h": { spanMs: 6 * 3600_000, bucketMs: 15 * 60_000 },
  "24h": { spanMs: 24 * 3600_000, bucketMs: 3600_000 },
  "7d": { spanMs: 7 * 24 * 3600_000, bucketMs: 6 * 3600_000 },
};

export const TrafficBucket = z.object({
  /** Bucket start. */
  time: EpochMs,
  messagesIn: z.number().int().nonnegative(),
  messagesOut: z.number().int().nonnegative(),
  /** My node's average reported channel utilization in the bucket; null without reports. */
  channelUtil: z.number().nullable(),
  /** Packets heard from other nodes (all ports). */
  packets: z.number().int().nonnegative(),
  /** `packets` by port name (`TEXT_MESSAGE_APP`, …, `ENCRYPTED`); ports without packets omitted. */
  packetsByPort: z.record(z.string(), z.number().int().nonnegative()),
});
export type TrafficBucket = z.infer<typeof TrafficBucket>;

/** `GET /api/connections/:id/traffic?window=`. */
export const TrafficDTO = z.object({
  window: TrafficWindow,
  bucketMs: z.number().int().positive(),
  from: EpochMs,
  to: EpochMs,
  buckets: z.array(TrafficBucket),
  /** Ports seen in the window, most packets first. */
  ports: z.array(z.object({ port: z.string(), packets: z.number().int().nonnegative() })),
  /** The nodes heard most in the window (up to 5), most packets first. */
  topNodes: z.array(z.object({ num: Uint32, packets: z.number().int().nonnegative() })),
});
export type TrafficDTO = z.infer<typeof TrafficDTO>;

export const HISTORY_WINDOWS = ["24h", "7d"] as const;
export const HistoryWindow = z.enum(HISTORY_WINDOWS);
export type HistoryWindow = z.infer<typeof HistoryWindow>;

/** `GET /api/connections/:id/nodes/:num/history?window=`: stored reports, oldest first. */
export const NodeHistory = z.object({
  window: HistoryWindow,
  device: z.array(
    z.object({
      time: EpochMs,
      batteryLevel: z.number().int().nullable(),
      voltage: z.number().nullable(),
      channelUtil: z.number().nullable(),
      airUtilTx: z.number().nullable(),
    }),
  ),
  environment: z.array(
    z.object({
      time: EpochMs,
      temperature: z.number().nullable(),
      humidity: z.number().nullable(),
      pressure: z.number().nullable(),
    }),
  ),
  positions: z.array(
    z.object({
      time: EpochMs,
      lat: z.number(),
      lon: z.number(),
      altitude: z.number().int().nullable(),
    }),
  ),
  /** Packets heard from the node per bucket (1 h for 24 h, 6 h for 7 d), every bucket present. */
  heard: z.object({
    bucketMs: z.number().int().positive(),
    buckets: z.array(z.object({ time: EpochMs, packets: z.number().int().nonnegative() })),
  }),
});
export type NodeHistory = z.infer<typeof NodeHistory>;

/**
 * What is actually known about how nodes connect. Only two kinds of link:
 * `direct` — my node heard that node's last packet with 0 hops (SNR as my node measured);
 * `reported` — a node's NeighborInfo report says it heard the other node (SNR as reported).
 * Hop counts place other nodes on rings; they never imply a route.
 */
export const TopologyDTO = z.object({
  myNodeNum: Uint32.nullable(),
  /** Nodes heard within this many ms are included. */
  windowMs: z.number().int().positive(),
  nodes: z.array(
    z.object({
      num: Uint32,
      hopsAway: z.number().int().nonnegative().nullable(),
      lastHeard: EpochMs.nullable(),
    }),
  ),
  links: z.array(
    z.object({
      kind: z.enum(["direct", "reported"]),
      /** For `reported`: the node that sent the report. For `direct`: my node. */
      from: Uint32,
      to: Uint32,
      snr: z.number().nullable(),
      time: EpochMs,
    }),
  ),
});
export type TopologyDTO = z.infer<typeof TopologyDTO>;
