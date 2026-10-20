import { nodeIdFromNum, type DmConversation, type MeshNode } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { Lock, SquarePen } from "lucide-react";
import { useState } from "react";
import { useNow } from "../components/useNow.js";
import { STATUS_LABELS } from "../dashboard/insights.js";
import { nodeStatus } from "../dashboard/view.js";
import { useConversationList } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import {
  filterChannels,
  filterDms,
  previewText,
  shortAgo,
  type ConversationRef,
} from "./conversation-list.js";
import { NodePicker } from "./NodePicker.js";
import { useNodeMap, useThresholds } from "./useNodeMap.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/** Every channel and DM conversation; `active` is the one open in the thread pane. */
export function ConversationList({ active }: { active: ConversationRef | null }) {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data, isPending } = useConversationList(connectionId);
  const nodes = useNodeMap(connectionId);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);

  const channels = filterChannels(data?.channels ?? [], query);
  const dms = filterDms(data?.dms ?? [], nodes, query);
  const searching = query.trim().length > 0;

  return (
    <aside data-mt="conversation-list" aria-label="Conversations">
      <div data-mt="conversation-toolbar">
        <input
          data-mt="conversation-search"
          type="search"
          placeholder="Search…"
          aria-label="Search conversations"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <button
          type="button"
          data-mt="new-dm-button"
          onClick={() => {
            setPicking(true);
          }}
        >
          <SquarePen data-mt="icon" {...ICON} />
          <span>New</span>
        </button>
      </div>

      {isPending && connectionId !== null ? (
        <p data-mt="conversation-list-loading">Loading conversations…</p>
      ) : (
        <>
          <section data-mt="conversation-section" data-mt-variant="channels" aria-label="Channels">
            <h2 data-mt="conversation-section-title">Channels</h2>
            {channels.length === 0 ? (
              <p data-mt="conversation-section-empty">
                {searching ? "No matching channels." : "No channels yet."}
              </p>
            ) : (
              <ul data-mt="conversation-rows">
                {channels.map((c) => {
                  const isActive = active?.kind === "channel" && active.index === c.index;
                  return (
                    <li key={c.index}>
                      <Link
                        to="/messages/channel/$index"
                        params={{ index: String(c.index) }}
                        data-mt="conversation-row"
                        data-mt-variant="channel"
                        data-mt-state={isActive ? "active" : "idle"}
                        data-channel-index={c.index}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <span data-mt="conversation-name">
                          <span data-mt="conversation-hash" aria-hidden>
                            #
                          </span>
                          {c.name}
                        </span>
                        {c.lastMessage && <RowTime time={c.lastMessage.rxTime} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section
            data-mt="conversation-section"
            data-mt-variant="dms"
            aria-label="Direct messages"
          >
            <h2 data-mt="conversation-section-title">Direct messages</h2>
            {dms.length === 0 ? (
              <p data-mt="conversation-section-empty">
                {searching
                  ? "No matching direct messages."
                  : "No direct messages yet. Start one with New."}
              </p>
            ) : (
              <ul data-mt="conversation-rows">
                {dms.map((d) => (
                  <li key={d.peer}>
                    <DmRow
                      dm={d}
                      node={nodes.get(d.peer)}
                      active={active?.kind === "dm" && active.num === d.peer}
                      connectionId={connectionId}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <NodePicker open={picking} onOpenChange={setPicking} />
    </aside>
  );
}

function RowTime({ time }: { time: number }) {
  const now = useNow();
  return (
    <time
      data-mt="conversation-time"
      dateTime={new Date(time).toISOString()}
      title={new Date(time).toLocaleString()}
    >
      {shortAgo(time, Math.max(now, time))}
    </time>
  );
}

function DmRow({
  dm,
  node,
  active,
  connectionId,
}: {
  dm: DmConversation;
  node: MeshNode | undefined;
  active: boolean;
  connectionId: number | null;
}) {
  const now = useNow();
  const thresholds = useThresholds(connectionId);
  const status = nodeStatus(node?.lastHeard ?? null, now, thresholds);
  const id = nodeIdFromNum(dm.peer);
  const short = node?.shortName || id.slice(-4);
  const long = node?.longName || id;
  const last = dm.lastMessage;
  return (
    <Link
      to="/messages/dm/$nodeId"
      params={{ nodeId: id }}
      data-mt="conversation-row"
      data-mt-variant="dm"
      data-mt-state={active ? "active" : "idle"}
      data-node-num={dm.peer}
      aria-current={active ? "page" : undefined}
    >
      <span data-mt="status-dot" data-mt-state={status} title={STATUS_LABELS[status]} />
      <span data-mt="conversation-name">
        <span data-mt="conversation-short-name">{short}</span>
        <span data-mt="conversation-long-name">{long}</span>
      </span>
      <RowTime time={last.rxTime} />
      <span data-mt="conversation-preview">
        {last.pkiEncrypted && (
          <Lock data-mt="icon" data-mt-variant="pki" aria-label="End-to-end encrypted" />
        )}
        <span data-mt="conversation-preview-text">{previewText(last)}</span>
      </span>
    </Link>
  );
}
