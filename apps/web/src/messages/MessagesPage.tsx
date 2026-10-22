import { channelDisplayName, nodeIdFromNum, nodeNumFromId, type MeshNode } from "@meshterm/shared";
import { Link, Navigate, Outlet, useParams } from "@tanstack/react-router";
import { ArrowLeft, Info, Lock, LockOpen } from "lucide-react";
import { useEffect, useMemo } from "react";
import { ConversationView } from "../components/ConversationView.js";
import { useNow } from "../components/useNow.js";
import { formatAgo } from "../dashboard/format.js";
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
import { useNodeMap, useThresholds } from "./useNodeMap.js";

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
          <h2 data-mt="thread-title">#{name}</h2>
          <div data-mt="thread-subtitle">
            {role && (
              <span data-mt="thread-pill" data-mt-variant={role.toLowerCase()}>
                {ROLE_LABEL[role]}
              </span>
            )}
            {encryption && (
              <span
                data-mt="encryption-badge"
                data-mt-variant={encryption === "none" ? "none" : "channel"}
                title={
                  encryption === "default"
                    ? "Encrypted with the well-known default key: anyone with the same preset can read it."
                    : undefined
                }
              >
                {encryption === "none" ? (
                  <LockOpen data-mt="icon" {...ICON} />
                ) : (
                  <Lock data-mt="icon" {...ICON} />
                )}
                {encryption === "none"
                  ? "Unencrypted"
                  : encryption === "default"
                    ? "Encrypted (default key)"
                    : "Encrypted"}
              </span>
            )}
          </div>
        </div>
      </header>
      <ConversationView conversation={conversation} />
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
      <ConversationView conversation={conversation} />
    </div>
  );
}

function hopsText(hops: number | null): string | null {
  if (hops === null) return null;
  return hops === 0 ? "heard directly" : hops === 1 ? "1 hop" : `${hops} hops`;
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
  const details = [
    node?.shortName,
    id,
    node?.lastHeard != null
      ? `seen ${formatAgo(node.lastHeard, Math.max(now, node.lastHeard))}`
      : "never heard",
    hopsText(node?.hopsAway ?? null),
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
            {pki ? <Lock data-mt="icon" {...ICON} /> : <LockOpen data-mt="icon" {...ICON} />}
            {pki ? "End-to-end" : "Channel key"}
          </span>
        </div>
      </div>
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
