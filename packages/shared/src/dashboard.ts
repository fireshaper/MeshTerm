import { z } from "zod";
import {
  ConnectionId,
  ConnectionState,
  DeviceMetrics,
  EnvironmentMetrics,
  EpochMs,
  Uint32,
} from "./domain.js";

/**
 * When a node counts as online / recent / stale (minutes since last heard; beyond
 * stale it is offline), and when utilization tiles turn warn / danger (percent).
 */
export const DashboardThresholds = z.object({
  onlineMin: z.number().positive(),
  recentMin: z.number().positive(),
  staleMin: z.number().positive(),
  channelUtilWarn: z.number().nonnegative(),
  channelUtilDanger: z.number().nonnegative(),
  airUtilTxWarn: z.number().nonnegative(),
  airUtilTxDanger: z.number().nonnegative(),
});
export type DashboardThresholds = z.infer<typeof DashboardThresholds>;

export const DEFAULT_DASHBOARD_THRESHOLDS: DashboardThresholds = {
  onlineMin: 15,
  recentMin: 120,
  staleMin: 1440,
  channelUtilWarn: 25,
  channelUtilDanger: 50,
  airUtilTxWarn: 7,
  airUtilTxDanger: 10,
};

export const DashboardSummary = z.object({
  connectionId: ConnectionId,
  connectionState: ConnectionState,
  /** When the connection entered its current state, if that state is `connected`. */
  connectedSince: EpochMs.nullable(),
  nodesTotal: z.number().int().nonnegative(),
  nodesOnline: z.number().int().nonnegative(),
  myNodeNum: Uint32.nullable(),
  myBattery: z.number().int().nonnegative().nullable(),
  channelUtil: z.number().nullable(),
  airUtilTx: z.number().nullable(),
  messages24h: z.number().int().nonnegative(),
  lastPacketAt: EpochMs.nullable(),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;

export const CardPosition = z.object({
  lat: z.number(),
  lon: z.number(),
  alt: z.number().int().nullable(),
  precisionBits: z.number().int().nullable(),
  time: EpochMs,
});
export type CardPosition = z.infer<typeof CardPosition>;

/** `[epoch ms, battery level]`, one point per 30-minute bucket over the last 24 h. */
export const SparkPoint = z.tuple([EpochMs, z.number()]);
export type SparkPoint = z.infer<typeof SparkPoint>;

/** Everything one dashboard card shows. */
export const NodeCard = z.object({
  num: Uint32,
  /** `!` + 8 hex digits. */
  userId: z.string(),
  longName: z.string(),
  shortName: z.string(),
  role: z.string().nullable(),
  hwModel: z.string().nullable(),
  isFavorite: z.boolean(),
  isSelf: z.boolean(),
  lastHeard: EpochMs.nullable(),
  hopsAway: z.number().int().nonnegative().nullable(),
  snr: z.number().nullable(),
  rssi: z.number().int().nullable(),
  position: CardPosition.nullable(),
  /** Null when the node never reported device metrics. */
  device: DeviceMetrics.extend({ time: EpochMs }).nullable(),
  environment: EnvironmentMetrics.extend({ time: EpochMs }).nullable(),
  batterySpark: z.array(SparkPoint).max(48),
});
export type NodeCard = z.infer<typeof NodeCard>;

/** `GET /api/connections/:id/dashboard`. */
export const DashboardDTO = z.object({
  summary: DashboardSummary,
  thresholds: DashboardThresholds,
  /** My node first, then most recently heard. The client sorts and filters. */
  nodes: z.array(NodeCard),
});
export type DashboardDTO = z.infer<typeof DashboardDTO>;
