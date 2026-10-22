import {
  nodeIdFromNum,
  type ChannelConversation,
  type ConversationKind,
  type DmConversation,
  type MeshNode,
} from "@meshterm/shared";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellOff, Lock, MoreHorizontal, SquarePen, Star } from "lucide-react";
import { useState } from "react";
import { useIsAdmin } from "../auth/me.js";
import { ApiError, api } from "../data/api.js";
import {
  applyReadToConversations,
  applyStateToConversations,
  badgeText,
} from "../data/conversations-cache.js";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
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
  const [showIgnored, setShowIgnored] = useState(false);

  const channels = filterChannels(data?.channels ?? [], query);
  const ignoredCount = (data?.dms ?? []).filter((d) => d.ignored).length;
  // Favorites first (Messages spec §3), then newest.
  const dms = filterDms(data?.dms ?? [], nodes, query)
    .filter((d) => showIgnored || !d.ignored)
    .sort((a, b) => Number(b.state.favorite) - Number(a.state.favorite));
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
                    <li key={c.index} data-mt="conversation-item">
                      <Link
                        to="/messages/channel/$index"
                        params={{ index: String(c.index) }}
                        data-mt="conversation-row"
                        data-mt-variant="channel"
                        data-mt-state={rowState(isActive, c)}
                        data-channel-index={c.index}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <span data-mt="conversation-name">
                          <span data-mt="conversation-hash" aria-hidden>
                            #
                          </span>
                          {c.name}
                        </span>
                        <span data-mt="conversation-meta">
                          <RowFlags row={c} />
                          {c.lastMessage && <RowTime time={c.lastMessage.rxTime} />}
                          <UnreadBadge row={c} />
                        </span>
                      </Link>
                      <RowMenu
                        connectionId={connectionId}
                        kind="channel"
                        keyNum={c.index}
                        row={c}
                        label={`#${c.name}`}
                      />
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
            {ignoredCount > 0 && (
              <label data-mt="show-ignored">
                <input
                  type="checkbox"
                  checked={showIgnored}
                  onChange={(e) => {
                    setShowIgnored(e.target.checked);
                  }}
                />
                Show ignored ({ignoredCount})
              </label>
            )}
            {dms.length === 0 ? (
              <p data-mt="conversation-section-empty">
                {searching
                  ? "No matching direct messages."
                  : "No direct messages yet. Start one with New."}
              </p>
            ) : (
              <ul data-mt="conversation-rows">
                {dms.map((d) => (
                  <li key={d.peer} data-mt="conversation-item">
                    <DmRow
                      dm={d}
                      node={nodes.get(d.peer)}
                      active={active?.kind === "dm" && active.num === d.peer}
                      connectionId={connectionId}
                    />
                    <RowMenu
                      connectionId={connectionId}
                      kind="dm"
                      keyNum={d.peer}
                      row={d}
                      label={nodes.get(d.peer)?.shortName || nodeIdFromNum(d.peer)}
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

type Row = ChannelConversation | DmConversation;

/** Space-separated tokens (themes match with `~=`): active/idle, unread, muted, favorite. */
function rowState(active: boolean, row: Row): string {
  return [
    active ? "active" : "idle",
    row.unread > 0 && "unread",
    row.state.muted && "muted",
    row.state.favorite && "favorite",
  ]
    .filter(Boolean)
    .join(" ");
}

function RowFlags({ row }: { row: Row }) {
  return (
    <>
      {row.state.favorite && (
        <Star data-mt="icon" data-mt-variant="favorite" aria-label="Favorite" />
      )}
      {row.state.muted && <BellOff data-mt="icon" data-mt-variant="muted" aria-label="Muted" />}
    </>
  );
}

/** The unread count (99+); muted conversations show it subdued. */
function UnreadBadge({ row }: { row: Row }) {
  if (row.unread === 0) return null;
  return (
    <>
      {row.unreadMentions > 0 && (
        <span data-mt="mention-marker" aria-label={`${row.unreadMentions} mentioning you`}>
          @
        </span>
      )}
      <span
        data-mt="unread-badge"
        data-mt-variant={row.state.muted ? "muted" : undefined}
        aria-label={`${row.unread} unread`}
      >
        {badgeText(row.unread)}
      </span>
    </>
  );
}

/** Mark read, Mute, Favorite, Delete (DMs) for one row (Messages spec §3). */
function RowMenu({
  connectionId,
  kind,
  keyNum,
  row,
  label,
}: {
  connectionId: number | null;
  kind: ConversationKind;
  keyNum: number;
  row: Row;
  label: string;
}) {
  const qc = useQueryClient();
  const admin = useIsAdmin();
  const toast = useUiStore((st) => st.toast);
  if (connectionId === null) return null;
  const key = queryKeys.conversations(connectionId);
  const fail = (err: unknown) => {
    toast(err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.", "error");
  };
  const patch = (change: { muted?: boolean; favorite?: boolean }) => {
    api.updateConversation(connectionId, kind, keyNum, change).then((state) => {
      qc.setQueryData(key, (d: Parameters<typeof applyStateToConversations>[0] | undefined) =>
        d ? applyStateToConversations(d, kind, keyNum, state) : d,
      );
    }, fail);
  };
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" data-mt="conversation-menu-button" aria-label={`More for ${label}`}>
          <MoreHorizontal data-mt="icon" aria-hidden focusable={false} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-mt="conversation-menu" align="end" sideOffset={4}>
          <Menu.Item
            data-mt="menu-item"
            disabled={row.unread === 0}
            onSelect={() => {
              api.markRead(connectionId, kind, keyNum).then((state) => {
                qc.setQueryData(
                  key,
                  (d: Parameters<typeof applyReadToConversations>[0] | undefined) =>
                    d ? applyReadToConversations(d, kind, keyNum, state.lastReadRxTime).data : d,
                );
              }, fail);
            }}
          >
            Mark read
          </Menu.Item>
          {admin && (
            <>
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  patch({ muted: !row.state.muted });
                }}
              >
                {row.state.muted ? "Unmute" : "Mute"}
              </Menu.Item>
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  patch({ favorite: !row.state.favorite });
                }}
              >
                {row.state.favorite ? "Remove from favorites" : "Favorite"}
              </Menu.Item>
              {kind === "dm" && (
                <Menu.Item
                  data-mt="menu-item"
                  data-mt-variant="danger"
                  onSelect={() => {
                    if (
                      window.confirm(
                        `Delete the conversation with ${label}? This clears MeshTerm's copy only; nothing is sent.`,
                      )
                    ) {
                      api.deleteDm(connectionId, keyNum).then(() => {
                        void qc.invalidateQueries({ queryKey: key });
                      }, fail);
                    }
                  }}
                >
                  Delete conversation
                </Menu.Item>
              )}
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
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
      data-mt-state={rowState(active, dm)}
      data-node-num={dm.peer}
      aria-current={active ? "page" : undefined}
    >
      <span data-mt="status-dot" data-mt-state={status} title={STATUS_LABELS[status]} />
      <span data-mt="conversation-name">
        <span data-mt="conversation-short-name">{short}</span>
        <span data-mt="conversation-long-name">{long}</span>
      </span>
      <span data-mt="conversation-meta">
        <RowFlags row={dm} />
        <RowTime time={last.rxTime} />
        <UnreadBadge row={dm} />
      </span>
      <span data-mt="conversation-preview">
        {last.pkiEncrypted && (
          <Lock data-mt="icon" data-mt-variant="pki" aria-label="End-to-end encrypted" />
        )}
        <span data-mt="conversation-preview-text">{previewText(last)}</span>
      </span>
    </Link>
  );
}
