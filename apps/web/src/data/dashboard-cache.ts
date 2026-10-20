import type {
  CardPosition,
  ConnectionState,
  DashboardDTO,
  MeshNode,
  Message,
  NodeCard,
  NodePosition,
  SparkPoint,
  TelemetryReport,
} from "@meshterm/shared";

/** Spark buckets as the server builds them (30 min, last 24 h, at most 48). */
export const SPARK_BUCKET_MS = 30 * 60_000;
export const SPARK_WINDOW_MS = 24 * 3600_000;
export const SPARK_MAX_POINTS = 48;

/**
 * Pure patches of a cached `DashboardDTO` from WS events. Each returns the same
 * object when nothing changed, so React Query notifies no one. Events for nodes the
 * dashboard doesn't know are ignored (except `node.upsert`, which adds a card); the
 * 10-minute refetch catches anything missed.
 */

function patchCard(
  data: DashboardDTO,
  num: number,
  update: (card: NodeCard) => NodeCard,
): DashboardDTO {
  const i = data.nodes.findIndex((c) => c.num === num);
  const card = data.nodes[i];
  if (!card) return data;
  const next = update(card);
  if (next === card) return data;
  const nodes = [...data.nodes];
  nodes[i] = next;
  return { ...data, nodes };
}

/** A new or changed node from the node DB. RSSI isn't in `MeshNode`: it refreshes with the refetch. */
export function applyNodeUpsert(data: DashboardDTO, node: MeshNode): DashboardDTO {
  const lastPacketAt =
    node.lastHeard !== null && node.lastHeard > (data.summary.lastPacketAt ?? 0)
      ? node.lastHeard
      : data.summary.lastPacketAt;
  const fields = {
    userId: node.id,
    longName: node.longName,
    shortName: node.shortName,
    role: node.role,
    hwModel: node.hwModel,
    isFavorite: node.isFavorite,
    lastHeard: node.lastHeard,
    hopsAway: node.hopsAway,
    snr: node.snr,
  };
  const known = data.nodes.some((c) => c.num === node.num);
  const withCard = known
    ? patchCard(data, node.num, (card) => ({ ...card, ...fields }))
    : {
        ...data,
        nodes: [
          ...data.nodes,
          {
            num: node.num,
            ...fields,
            isSelf: node.num === data.summary.myNodeNum,
            rssi: null,
            position: null,
            device: null,
            environment: null,
            batterySpark: [],
          },
        ],
      };
  return lastPacketAt === data.summary.lastPacketAt
    ? withCard
    : { ...withCard, summary: { ...withCard.summary, lastPacketAt } };
}

/** Appends a battery reading to a spark: same 30-min bucket replaces, older than 24 h drops. */
export function appendSpark(spark: SparkPoint[], time: number, level: number): SparkPoint[] {
  const bucket = Math.floor(time / SPARK_BUCKET_MS);
  const last = spark[spark.length - 1];
  if (last && last[0] > time) return spark; // out of order: the refetch will place it
  const kept =
    last && Math.floor(last[0] / SPARK_BUCKET_MS) === bucket ? spark.slice(0, -1) : spark;
  return [...kept, [time, level] as SparkPoint]
    .filter(([t]) => t > time - SPARK_WINDOW_MS)
    .slice(-SPARK_MAX_POINTS);
}

/** Non-null fields of `update` win; older reports than what the card shows are ignored. */
function merge<T extends { time: number }>(current: T | null, update: T): T | null {
  if (current && current.time > update.time) return null;
  const merged = { ...(current ?? update) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(update as Record<string, unknown>))
    if (value !== null) merged[key] = value;
  return merged as T;
}

export function applyTelemetry(data: DashboardDTO, report: TelemetryReport): DashboardDTO {
  // Power-monitor and air-quality readings aren't on dashboard cards.
  if (report.kind === "power" || report.kind === "air_quality") return data;
  return patchCard(data, report.nodeNum, (card) => {
    if (report.kind === "environment") {
      const environment = merge(card.environment, { ...report.environment, time: report.time });
      return environment ? { ...card, environment } : card;
    }
    const device = merge(card.device, { ...report.device, time: report.time });
    const level = report.device.batteryLevel;
    const batterySpark =
      level === null ? card.batterySpark : appendSpark(card.batterySpark, report.time, level);
    if (!device && batterySpark === card.batterySpark) return card;
    return { ...card, device: device ?? card.device, batterySpark };
  });
}

export function applyPosition(data: DashboardDTO, position: NodePosition): DashboardDTO {
  return patchCard(data, position.nodeNum, (card) => {
    if (card.position && card.position.time > position.time) return card;
    const next: CardPosition = {
      lat: position.lat,
      lon: position.lon,
      alt: position.altitude,
      precisionBits: position.precisionBits,
      time: position.time,
    };
    return { ...card, position: next };
  });
}

/** `now` is when the event arrived; the server's "since" is when the state began. */
export function applyConnectionState(
  data: DashboardDTO,
  state: ConnectionState,
  now: number,
): DashboardDTO {
  if (data.summary.connectionState === state) return data;
  return {
    ...data,
    summary: {
      ...data.summary,
      connectionState: state,
      connectedSince: state === "connected" ? now : null,
    },
  };
}

/** A new message counts toward "Messages (24 h)" and moves "Last packet" for inbound ones. */
export function applyMessage(data: DashboardDTO, message: Message): DashboardDTO {
  const inbound = message.direction === "in";
  const lastPacketAt =
    inbound && message.rxTime > (data.summary.lastPacketAt ?? 0)
      ? message.rxTime
      : data.summary.lastPacketAt;
  return {
    ...data,
    summary: {
      ...data.summary,
      messages24h: data.summary.messages24h + 1,
      messagesIn24h: data.summary.messagesIn24h + (inbound ? 1 : 0),
      messagesOut24h: data.summary.messagesOut24h + (inbound ? 0 : 1),
      lastPacketAt,
    },
  };
}

/** Local favorite toggle, applied before the server confirms. */
export function applyFavorite(data: DashboardDTO, num: number, isFavorite: boolean): DashboardDTO {
  return patchCard(data, num, (card) =>
    card.isFavorite === isFavorite ? card : { ...card, isFavorite },
  );
}
