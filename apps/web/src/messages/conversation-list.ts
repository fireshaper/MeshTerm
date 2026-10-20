import type {
  ChannelConversation,
  DmConversation,
  MeshNode,
  MessagePreview,
} from "@meshterm/shared";
import { nodeIdFromNum } from "@meshterm/shared";

/** A conversation as the URL names it: `channel/0` or `dm/!a1b2c3d4`. */
export type ConversationRef = { kind: "channel"; index: number } | { kind: "dm"; num: number };

export const LAST_CONVERSATION_KEY = "meshterm.lastConversation";

export function refPath(ref: ConversationRef): string {
  return ref.kind === "channel" ? `channel/${ref.index}` : `dm/${nodeIdFromNum(ref.num)}`;
}

/** The conversation the reader had open last in this browser, if storage allows. */
export function readLastConversation(): string | null {
  try {
    const value = localStorage.getItem(LAST_CONVERSATION_KEY);
    return value && /^(channel\/[0-7]|dm\/![0-9a-f]{8})$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastConversation(ref: ConversationRef): void {
  try {
    localStorage.setItem(LAST_CONVERSATION_KEY, refPath(ref));
  } catch {
    // Storage blocked: nothing to remember.
  }
}

/** One line for a conversation row: "You: " for our own messages; reactions say so. */
export function previewText(m: MessagePreview): string {
  const body = m.emoji ? `Reacted ${m.text}` : m.text.replace(/\s+/g, " ").trim();
  return m.direction === "out" ? `You: ${body}` : body;
}

const normalize = (s: string) => s.trim().toLowerCase();

/** Channels whose name contains the query (case-insensitive); all for an empty query. */
export function filterChannels(
  channels: readonly ChannelConversation[],
  query: string,
): ChannelConversation[] {
  const q = normalize(query).replace(/^#/, "");
  return q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : [...channels];
}

/** Whether a node matches a search by long name, short name or node id (with or without `!`). */
export function nodeMatches(num: number, node: MeshNode | undefined, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const id = nodeIdFromNum(num);
  return (
    (node?.longName.toLowerCase().includes(q) ?? false) ||
    (node?.shortName.toLowerCase().includes(q) ?? false) ||
    id.includes(q) ||
    id.slice(1).includes(q.replace(/^!/, ""))
  );
}

export function filterDms(
  dms: readonly DmConversation[],
  nodes: ReadonlyMap<number, MeshNode>,
  query: string,
): DmConversation[] {
  return dms.filter((d) => nodeMatches(d.peer, nodes.get(d.peer), query));
}

/** "now", "5m", "3h", "2d", then a short date: compact enough for a list row. */
export function shortAgo(time: number, now: number): string {
  const s = Math.max(0, Math.floor((now - time) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Not heard for this long: the New DM picker warns that the DM may not arrive. */
export const QUIET_WARN_MS = 24 * 3600_000;

export interface PickerWarning {
  kind: "quiet" | "no-key";
  text: string;
}

/** Why a DM to this node might not go as expected (spec §3, New DM). */
export function pickerWarnings(node: MeshNode, now: number): PickerWarning[] {
  const warnings: PickerWarning[] = [];
  if (node.lastHeard === null || now - node.lastHeard > QUIET_WARN_MS) {
    warnings.push({ kind: "quiet", text: "Not heard in 24 h" });
  }
  if (!node.hasPublicKey) {
    warnings.push({ kind: "no-key", text: "No public key: channel encryption" });
  }
  return warnings;
}

/** Nodes for the New DM picker: not ourselves, favorites first, then most recently heard. */
export function pickerNodes(
  nodes: readonly MeshNode[],
  myNodeNum: number | null,
  query: string,
): MeshNode[] {
  return nodes
    .filter((n) => n.num !== myNodeNum && nodeMatches(n.num, n, query))
    .sort(
      (a, b) =>
        Number(b.isFavorite) - Number(a.isFavorite) ||
        (b.lastHeard ?? -1) - (a.lastHeard ?? -1) ||
        a.num - b.num,
    );
}
