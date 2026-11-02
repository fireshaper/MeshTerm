import { MAX_TEXT_BYTES, type MeshNode, type Message } from "@meshterm/shared";
import { dayLabel } from "../components/MessageItem.js";
import { formatDistance, haversineMeters, type LatLon } from "../dashboard/geo.js";

/** Consecutive messages from one sender within this gap (and on the same day) group. */
export const GROUP_GAP_MS = 10 * 60_000;

/** Whether `m` continues the group `previous` started: same sender and side, same day, close in time. */
export function continuesGroup(previous: Message | undefined, m: Message): boolean {
  return (
    previous !== undefined &&
    previous.fromNum === m.fromNum &&
    previous.direction === m.direction &&
    !previous.emoji &&
    !m.emoji &&
    m.rxTime - previous.rxTime <= GROUP_GAP_MS &&
    dayLabel(previous.rxTime) === dayLabel(m.rxTime)
  );
}

/** Hops the packet took to reach us (`hop_start − hop_limit`); null when the firmware didn't say. */
export function hopsTaken(m: Pick<Message, "hopStart" | "hopLimit">): number | null {
  if (m.hopStart === null || m.hopLimit === null || m.hopStart === 0) return null;
  return m.hopStart >= m.hopLimit ? m.hopStart - m.hopLimit : null;
}

/** "direct", "1 hop", "3 hops". */
export function hopsLabel(hops: number): string {
  return hops === 0 ? "direct" : hops === 1 ? "1 hop" : `${hops} hops`;
}

/**
 * The incoming message's route in a few words: "4.6 km · direct · 7.25 dB", "16 km · 2 hops",
 * "via MQTT". SNR only for direct messages: relayed, it's the last relay's, not the sender's.
 */
export function messagePath(
  m: Message,
  origin: LatLon | null,
  senderPosition: LatLon | null,
): string | null {
  const parts: string[] = [];
  if (origin && senderPosition) parts.push(formatDistance(haversineMeters(origin, senderPosition)));
  if (m.viaMqtt) {
    parts.push("via MQTT");
  } else {
    const hops = hopsTaken(m);
    if (hops !== null) parts.push(hopsLabel(hops));
    if (hops === 0 && m.rxSnr !== null) parts.push(`${m.rxSnr} dB`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The byte meter turns `near` past this many bytes, `over` past the limit. */
export const NEAR_BYTES = 170;

export type ByteMeterState = "ok" | "near" | "over";

export function byteMeterState(bytes: number): ByteMeterState {
  return bytes > MAX_TEXT_BYTES ? "over" : bytes > NEAR_BYTES ? "near" : "ok";
}

/**
 * Where the "New" line goes: the first incoming message (not a reaction) after the read
 * mark the thread opened with; -1 when everything was read.
 */
export function firstUnreadIndex(messages: readonly Message[], readMark: number | null): number {
  if (readMark === null) return -1;
  return messages.findIndex((m) => m.direction === "in" && !m.emoji && m.rxTime > readMark);
}

/** Within this long counts as "heard this hour" in a channel's header. */
export const HEARD_WINDOW_MS = 3600_000;

/** Other nodes heard in the last hour, most recent first. */
export function heardThisHour(
  nodes: Iterable<MeshNode>,
  now: number,
  myNodeNum: number | null,
): MeshNode[] {
  return [...nodes]
    .filter(
      (n) => n.num !== myNodeNum && n.lastHeard !== null && now - n.lastHeard <= HEARD_WINDOW_MS,
    )
    .sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0) || a.num - b.num);
}
