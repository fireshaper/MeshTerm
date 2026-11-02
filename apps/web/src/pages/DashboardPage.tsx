import type { DashboardDTO, NodeCard } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState, Panel } from "../components/Panel.js";
import { useNow } from "../components/useNow.js";
import { ActivityFeed } from "../dashboard/ActivityFeed.js";
import { AttentionList } from "../dashboard/AttentionList.js";
import { Conditions } from "../dashboard/Conditions.js";
import { attentionItems } from "../dashboard/insights.js";
import { NetworkMap } from "../dashboard/NetworkMap.js";
import { NodePreviewCard } from "../dashboard/NodePreviewCard.js";
import { rosterCards } from "../dashboard/overview.js";
import { OverviewHero } from "../dashboard/OverviewHero.js";
import { TrafficPanel } from "../dashboard/TrafficPanel.js";
import { useIsAdmin } from "../auth/me.js";
import { useToggleFavorite } from "../dashboard/useFavorite.js";
import { api, ApiError } from "../data/api.js";
import { useDashboard } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { useUiStore } from "../data/ui-store.js";

/** How many nodes the Overview's roster shows; the Nodes page has the rest (CR-005 §6.2). */
export const ROSTER_LIMIT = 12;

/** Drops and re-establishes the link to my node; disabled while one is in progress. Admins only. */
function ReconnectButton({ connectionId }: { connectionId: number | null }) {
  const admin = useIsAdmin();
  const nodeState = useLiveStore((s) => s.nodeState);
  const toast = useUiStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const inProgress = nodeState === "connecting" || nodeState === "configuring";
  if (!admin) return null;
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

function DashboardHeader({ connectionId }: { connectionId: number | null }) {
  return (
    <PageHeader title="Overview">
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
      <DashboardHeader connectionId={connectionId} />
      {loading ? (
        <div data-mt="dashboard-waiting" aria-busy="true" aria-label="Loading the overview">
          <Skeleton variant="hero" />
          <Skeleton variant="panel" />
        </div>
      ) : isError ? (
        <p data-mt="dashboard-error" role="alert">
          The overview couldn&apos;t be loaded. Is the MeshTerm server running?
        </p>
      ) : (
        <>
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

/**
 * The Overview (CR-005 §6.2): the hero map with the headline, my node's conditions, what
 * needs a look, the field log, messages over 24 h, the roster, and the mesh detail
 * (topology and packet types) folded away at the bottom.
 */
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
  const origin = nodes.find((n) => n.isSelf)?.position ?? null;
  const attention = attentionItems(nodes, now, thresholds);
  const roster = rosterCards(nodes, ROSTER_LIMIT);

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

  return (
    <div data-mt="overview-grid">
      <OverviewHero cards={nodes} thresholds={thresholds} now={now} />
      <div data-mt="overview-side">
        <Conditions data={data} />
        <Panel variant="attention" title="Needs a look" count={attention.length}>
          {attention.length === 0 ? (
            <EmptyState title="All clear">
              No low batteries, quiet favorites or busy channel right now.
            </EmptyState>
          ) : (
            <AttentionList items={attention} />
          )}
        </Panel>
      </div>
      <ActivityFeed connectionId={connectionId} cards={nodes} title="Field log" />
      <TrafficPanel
        connectionId={connectionId}
        cards={nodes}
        view="messages"
        variant="messages"
        title="Messages"
        areas
      />
      <Panel
        variant="roster"
        title="Roster"
        count={nodes.length}
        actions={
          <Link to="/nodes" data-mt="panel-link">
            All nodes
            <ArrowRight data-mt="icon" aria-hidden focusable={false} />
          </Link>
        }
      >
        {nodes.length === 0 ? (
          <EmptyState title="No nodes yet">
            The roster fills in once MeshTerm finishes the config handshake with your node, and
            grows as other nodes are heard on the mesh.
          </EmptyState>
        ) : (
          <ul data-mt="preview-grid">{roster.map(preview)}</ul>
        )}
      </Panel>
      <details data-mt="mesh-detail">
        <summary data-mt="mesh-detail-summary">Mesh detail: topology and packets</summary>
        <div data-mt="mesh-detail-body">
          <NetworkMap connectionId={connectionId} cards={nodes} thresholds={thresholds} />
          <TrafficPanel
            connectionId={connectionId}
            cards={nodes}
            view="packets"
            variant="packets"
            title="Packets by type"
          />
        </div>
      </details>
    </div>
  );
}
