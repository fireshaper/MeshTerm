import type { DashboardDTO, NodeCard } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState, Panel } from "../components/Panel.js";
import { useNow } from "../components/useNow.js";
import { ActivityFeed } from "../dashboard/ActivityFeed.js";
import { AttentionList } from "../dashboard/AttentionList.js";
import { formatAbsolute, formatAgo } from "../dashboard/format.js";
import { attentionItems, recentlyActive } from "../dashboard/insights.js";
import { NetworkKpis } from "../dashboard/NetworkKpis.js";
import { NetworkMap } from "../dashboard/NetworkMap.js";
import { NodePreviewCard } from "../dashboard/NodePreviewCard.js";
import { TrafficPanel } from "../dashboard/TrafficPanel.js";
import { useToggleFavorite } from "../dashboard/useFavorite.js";
import { api, ApiError } from "../data/api.js";
import { useDashboard } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { useUiStore } from "../data/ui-store.js";

/** How many recently active nodes the dashboard previews; the Nodes page has the rest. */
export const RECENT_PREVIEW_LIMIT = 8;

function LastPacket({ at }: { at: number | null }) {
  const now = useNow(1000);
  if (at === null) return <span data-mt="dashboard-last-packet">No packets yet</span>;
  return (
    <span data-mt="dashboard-last-packet">
      Last packet{" "}
      <time dateTime={new Date(at).toISOString()} title={formatAbsolute(at)}>
        {formatAgo(at, now)}
      </time>
    </span>
  );
}

/** Drops and re-establishes the link to my node; disabled while one is in progress. */
function ReconnectButton({ connectionId }: { connectionId: number | null }) {
  const nodeState = useLiveStore((s) => s.nodeState);
  const toast = useUiStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const inProgress = nodeState === "connecting" || nodeState === "configuring";
  return (
    <button
      type="button"
      data-mt="button"
      data-mt-variant="reconnect"
      disabled={connectionId === null || busy || inProgress}
      onClick={() => {
        if (connectionId === null) return;
        setBusy(true);
        api
          .reconnect(connectionId)
          .then(
            () => {
              toast("Reconnecting to your node…", "info");
            },
            (err: unknown) => {
              toast(
                err instanceof ApiError && err.status === 429
                  ? "Too many reconnects; try again in a minute."
                  : "Couldn't reconnect.",
                "error",
              );
            },
          )
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <RefreshCw data-mt="icon" aria-hidden focusable={false} />
      Reconnect
    </button>
  );
}

function DashboardHeader({
  data,
  connectionId,
}: {
  data: DashboardDTO | undefined;
  connectionId: number | null;
}) {
  return (
    <PageHeader title="Dashboard" subtitle="Live overview of your Meshtastic network">
      {data && <LastPacket at={data.summary.lastPacketAt} />}
      <ReconnectButton connectionId={connectionId} />
    </PageHeader>
  );
}

function Skeleton({ variant }: { variant: string }) {
  return <div data-mt="skeleton" data-mt-variant={variant} aria-hidden />;
}

export function DashboardPage() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data, isPending, isError } = useDashboard(connectionId);
  const now = useNow();
  const toggleFavorite = useToggleFavorite(connectionId);
  const onFavorite = useCallback(
    (num: number, favorite: boolean) => {
      void toggleFavorite(num, favorite);
    },
    [toggleFavorite],
  );

  const loading = connectionId === null || isPending;

  return (
    <section data-mt="dashboard" data-mt-state={loading ? "loading" : isError ? "error" : "ready"}>
      <DashboardHeader data={data} connectionId={connectionId} />
      {loading ? (
        <div data-mt="dashboard-waiting" aria-busy="true" aria-label="Loading dashboard">
          <div data-mt="kpi-row">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} variant="metric" />
            ))}
          </div>
          <Skeleton variant="panel" />
        </div>
      ) : isError ? (
        <p data-mt="dashboard-error" role="alert">
          The dashboard couldn&apos;t be loaded. Is the MeshTerm server running?
        </p>
      ) : (
        <>
          <NetworkKpis data={data} />
          <DashboardBody
            connectionId={connectionId}
            data={data}
            now={now}
            onFavorite={onFavorite}
          />
        </>
      )}
    </section>
  );
}

function DashboardBody({
  connectionId,
  data,
  now,
  onFavorite,
}: {
  connectionId: number;
  data: DashboardDTO;
  now: number;
  onFavorite: (num: number, favorite: boolean) => void;
}) {
  const { nodes, thresholds } = data;
  const self = nodes.find((n) => n.isSelf) ?? null;
  const origin = self?.position ?? null;
  const favorites = nodes
    .filter((n) => n.isFavorite && !n.isSelf)
    .sort((a, b) => (b.lastHeard ?? -1) - (a.lastHeard ?? -1) || a.num - b.num);
  const pinned = self ? [self, ...favorites] : favorites;
  const recent = recentlyActive(nodes, now, thresholds);
  const attention = attentionItems(nodes, now, thresholds);

  const preview = (card: NodeCard) => (
    <li key={card.num} data-mt="preview-cell">
      <NodePreviewCard
        card={card}
        origin={origin}
        now={now}
        thresholds={thresholds}
        onFavorite={onFavorite}
      />
    </li>
  );
  const viewAll = (
    <Link to="/nodes" data-mt="panel-link">
      View all {nodes.length} nodes
      <ArrowRight data-mt="icon" aria-hidden focusable={false} />
    </Link>
  );

  if (nodes.length === 0) {
    return (
      <div data-mt="dashboard-grid">
        <Panel variant="pinned" title="My node & favorites">
          <div data-mt="dashboard-empty">
            <EmptyState title="No nodes yet">
              The node list fills in once MeshTerm finishes the config handshake with your node, and
              grows as other nodes are heard on the mesh.
            </EmptyState>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div data-mt="dashboard-grid">
      <TrafficPanel connectionId={connectionId} cards={nodes} />
      <NetworkMap connectionId={connectionId} cards={nodes} thresholds={thresholds} />
      <Panel variant="pinned" title="My node & favorites" count={pinned.length}>
        <ul data-mt="preview-grid">{pinned.map(preview)}</ul>
        {favorites.length === 0 && <p data-mt="panel-hint">Star nodes to pin them here.</p>}
      </Panel>
      <ActivityFeed connectionId={connectionId} cards={nodes} />
      <Panel variant="recent" title="Recently active" count={recent.length} actions={viewAll}>
        {recent.length === 0 ? (
          <EmptyState title="No other nodes heard recently">
            Nodes appear here when a packet from them is heard within {thresholds.recentMin / 60} h.
          </EmptyState>
        ) : (
          <ul data-mt="preview-grid">{recent.slice(0, RECENT_PREVIEW_LIMIT).map(preview)}</ul>
        )}
      </Panel>
      <Panel variant="attention" title="Attention needed" count={attention.length}>
        {attention.length === 0 ? (
          <EmptyState title="All clear">
            No low batteries, quiet favorites or busy channel right now.
          </EmptyState>
        ) : (
          <AttentionList items={attention} />
        )}
      </Panel>
    </div>
  );
}
