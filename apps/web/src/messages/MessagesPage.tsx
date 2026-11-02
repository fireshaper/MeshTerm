import { channelDisplayName, nodeIdFromNum, nodeNumFromId, type MeshNode } from "@meshterm/shared";
import { Link, Navigate, Outlet, useParams } from "@tanstack/react-router";
import { ArrowLeft, Info, KeyRound, Lock, LockOpen, MapPin } from "lucide-react";
import { useEffect, useMemo } from "react";
import { ConversationView } from "../components/ConversationView.js";
import { useNow } from "../components/useNow.js";
import { formatAgo } from "../dashboard/format.js";
import { bearingDegrees, cardinal, formatDistance, haversineMeters } from "../dashboard/geo.js";
import { STATUS_LABELS } from "../dashboard/insights.js";
import { nodeStatus } from "../dashboard/view.js";
import { useChannels, useConversationList } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { openNodeDetails } from "../data/ui-store.js";
import {
  readLastConversation,
  writeLastConversation,
  type ConversationRef,
} from "./conversation-list.js";
import { ConversationList } from "./ConversationList.js";
import { PermissionBanner } from "../notifications/PermissionBanner.js";
import { ThreadLevelMenu } from "../notifications/LevelMenu.js";
import { heardThisHour, hopsLabel } from "./thread.js";
import { usePositions, useNodeMap, useThresholds } from "./useNodeMap.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/** The conversation named by the URL, if any (`/messages/channel/1`, `/messages/dm/!…`). */
function useActiveRef(): ConversationRef | null {
  const params = useParams({ strict: false });
  if (params.index !== undefined) {
    const index = Number(params.index);
    return Number.isInteger(index) && index >= 0 && index <= 7 ? { kind: "channel", index } : null;
  }
  if (params.nodeId !== undefined) {
    const num = nodeNumFromId(params.nodeId);
    return num === null ? null : { kind: "dm", num };
  }
  return null;
}

/**
 * Two panes from 768 px (conversation list + thread); below that the list is the
 * screen and a conversation replaces it (`data-mt-state` says which is showing).
 */
export function MessagesPage() {
  const active = useActiveRef();
  const params = useParams({ strict: false });
  const showingThread = params.index !== undefined || params.nodeId !== undefined;
  return (
    <section data-mt="messages-view" data-mt-state={showingThread ? "thread" : "list"}>
      <h1 data-mt="visually-hidden">Messages</h1>
      <PermissionBanner />
      <ConversationList active={active} />
      <div data-mt="thread-pane">
        <Outlet />
      </div>
    </section>
  );
}

const WIDE = "(min-width: 768px)";

/**
 * `/messages`: on wide screens, open the last conversation (or the primary channel)
 * so the thread pane isn't empty; on phones the list is the screen.
 */
export function MessagesIndex() {
  const wide = typeof matchMedia === "function" && matchMedia(WIDE).matches;
  if (wide) {
    const last = readLastConversation();
    if (last?.startsWith("dm/")) {
      return <Navigate to="/messages/dm/$nodeId" params={{ nodeId: last.slice(3) }} replace />;
    }
    return (
      <Navigate
        to="/messages/channel/$index"
        params={{ index: last ? last.slice("channel/".length) : "0" }}
        replace
      />
    );
  }
  return <p data-mt="thread-empty">Pick a conversation.</p>;
}

function useRemember(ref: ConversationRef | null) {
  const key = ref ? (ref.kind === "channel" ? `c${ref.index}` : `d${ref.num}`) : null;
  useEffect(() => {
    if (ref) writeLastConversation(ref);
    // `key` identifies `ref`; the object itself is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function BackLink() {
  return (
    <Link to="/messages" data-mt="thread-back" aria-label="Back to conversations">
      <ArrowLeft data-mt="icon" {...ICON} />
    </Link>
  );
}

const ROLE_LABEL = { PRIMARY: "Primary", SECONDARY: "Secondary", DISABLED: "Disabled" } as const;

export function ChannelThread() {
  const { index } = useParams({ from: "/messages/channel/$index" });
  const channelIndex = Number(index);
  const valid = Number.isInteger(channelIndex) && channelIndex >= 0 && channelIndex <= 7;
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data: list } = useConversationList(connectionId);
  const { data: channels } = useChannels(connectionId);
  const fromList = list?.channels.find((c) => c.index === channelIndex);
  const raw = channels?.find((c) => c.index === channelIndex);
  const name = fromList?.name ?? (raw ? channelDisplayName(raw, null) : `Channel ${index}`);
  const role = fromList?.role ?? raw?.role ?? null;
  const encryption = fromList?.encryption ?? raw?.encryption ?? null;
  const conversation = useMemo(() => ({ channel: channelIndex }), [channelIndex]);
  useRemember(valid ? { kind: "channel", index: channelIndex } : null);

  if (!valid) return <p data-mt="thread-empty">No such channel.</p>;
  return (
    <div data-mt="thread" data-mt-variant="channel" data-channel-index={channelIndex}>
      <header data-mt="thread-header" data-mt-variant="channel">
        <BackLink />
        <div data-mt="thread-heading">
          <h2 data-mt="thread-title">
            <span data-mt="thread-hash" aria-hidden>
              #
            </span>
            {name}
          </h2>
          <div data-mt="thread-subtitle">
            <span data-mt="thread-details">Channel {channelIndex}</span>
            {role && (
              <span data-mt="thread-pill" data-mt-variant={role.toLowerCase()}>
                {ROLE_LABEL[role]}
              </span>
            )}
            {encryption && <ChannelKeyPill encryption={encryption} />}
          </div>
        </div>
        <HeardThisHour connectionId={connectionId} />
        <ThreadLevelMenu connectionId={connectionId} kind="channel" keyNum={channelIndex} />
      </header>
      <ConversationView
        conversation={conversation}
        destination={{ label: `CH ${channelIndex} · ${name}`, name }}
      />
    </div>
  );
}

const KEY_PILL = {
  none: {
    text: "Unencrypted",
    title: "Sent in the clear: anyone in range can read it.",
  },
  default: {
    text: "Default key, public",
    title: "Encrypted with the well-known default key: anyone with the same preset can read it.",
  },
  custom: { text: "Private", title: "Encrypted with this channel's own key." },
} as const;

function ChannelKeyPill({ encryption }: { encryption: "none" | "default" | "custom" }) {
  const pill = KEY_PILL[encryption];
  return (
    <span
      data-mt="encryption-badge"
      data-mt-variant={encryption === "custom" ? "channel" : encryption}
      title={pill.title}
    >
      {encryption === "custom" ? (
        <Lock data-mt="icon" {...ICON} />
      ) : (
        <LockOpen data-mt="icon" {...ICON} />
      )}
      {pill.text}
    </span>
  );
}

/** How many tags the channel header shows before "+N". */
const HEARD_TAGS = 5;

/** Callsigns my node heard in the last hour (on any channel): who might be listening. */
function HeardThisHour({ connectionId }: { connectionId: number | null }) {
  const now = useNow();
  const nodes = useNodeMap(connectionId);
  const myNodeNum = useLiveStore((s) => s.myNodeNum);
  const heard = heardThisHour(nodes.values(), now, myNodeNum);
  if (heard.length === 0) return null;
  const shown = heard.slice(0, HEARD_TAGS);
  return (
    <div data-mt="thread-heard" aria-label={`${heard.length} nodes heard this hour`}>
      <span data-mt="thread-heard-tags" aria-hidden>
        {shown.map((n) => (
          <span key={n.num} data-mt="callsign-tag" title={n.longName}>
            {n.shortName || nodeIdFromNum(n.num).slice(-4)}
          </span>
        ))}
      </span>
      <span data-mt="thread-heard-count" aria-hidden>
        {heard.length > shown.length ? `+${heard.length - shown.length} ` : ""}heard this hour
      </span>
    </div>
  );
}

export function DmThread() {
  const { nodeId } = useParams({ from: "/messages/dm/$nodeId" });
  const num = nodeNumFromId(nodeId);
  const connectionId = useLiveStore((s) => s.connectionId);
  const nodes = useNodeMap(connectionId);
  const conversation = useMemo(() => ({ peer: num ?? 0 }), [num]);
  useRemember(num === null ? null : { kind: "dm", num });

  if (num === null) return <p data-mt="thread-empty">That isn't a node ID.</p>;
  return (
    <div data-mt="thread" data-mt-variant="dm" data-node-num={num}>
      <DmHeader num={num} node={nodes.get(num)} connectionId={connectionId} />
      <ConversationView
        conversation={conversation}
        destination={{
          label: `DM · ${nodes.get(num)?.shortName || nodeIdFromNum(num)}`,
          name: nodes.get(num)?.longName || nodeIdFromNum(num),
        }}
      />
    </div>
  );
}

function DmHeader({
  num,
  node,
  connectionId,
}: {
  num: number;
  node: MeshNode | undefined;
  connectionId: number | null;
}) {
  const now = useNow();
  const thresholds = useThresholds(connectionId);
  const status = nodeStatus(node?.lastHeard ?? null, now, thresholds);
  const id = nodeIdFromNum(num);
  const pki = node?.hasPublicKey ?? false;
  const { origin, byNum } = usePositions(connectionId);
  const position = byNum.get(num) ?? null;
  const where =
    origin && position
      ? `${formatDistance(haversineMeters(origin, position))} ${cardinal(bearingDegrees(origin, position))}`
      : null;
  const details = [
    id,
    node?.hopsAway != null ? hopsLabel(node.hopsAway) : null,
    where,
    node?.hopsAway === 0 && node.snr !== null ? `${node.snr} dB` : null,
    node?.lastHeard != null
      ? `seen ${formatAgo(node.lastHeard, Math.max(now, node.lastHeard))}`
      : "never heard",
  ].filter(Boolean);
  return (
    <header data-mt="thread-header" data-mt-variant="dm">
      <BackLink />
      <span data-mt="status-dot" data-mt-state={status} title={STATUS_LABELS[status]} />
      <div data-mt="thread-heading">
        <h2 data-mt="thread-title">{node?.longName || id}</h2>
        <div data-mt="thread-subtitle">
          <span data-mt="thread-details">{details.join(" · ")}</span>
          <span
            data-mt="encryption-badge"
            data-mt-variant={pki ? "pki" : "channel"}
            title={
              pki
                ? "End-to-end encrypted with the node's public key."
                : "This node hasn't shared a public key, so DMs use the channel key."
            }
          >
            {pki ? <KeyRound data-mt="icon" {...ICON} /> : <LockOpen data-mt="icon" {...ICON} />}
            {pki ? "Public-key encrypted" : "Channel key only"}
          </span>
        </div>
      </div>
      {position && (
        <Link to="/map" search={{ focus: id }} data-mt="button" data-mt-variant="show-on-map">
          <MapPin data-mt="icon" {...ICON} />
          On map
        </Link>
      )}
      <ThreadLevelMenu connectionId={connectionId} kind="dm" keyNum={num} />
      <button
        type="button"
        data-mt="thread-info"
        aria-label="Node details"
        onClick={() => {
          openNodeDetails(num);
        }}
      >
        <Info data-mt="icon" {...ICON} />
      </button>
    </header>
  );
}
