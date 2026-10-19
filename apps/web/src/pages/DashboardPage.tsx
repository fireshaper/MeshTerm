import type { NodeCard as NodeCardData } from "@meshterm/shared";
import { useCallback, useMemo, useState } from "react";
import { useNow } from "../components/useNow.js";
import { CardGrid, VIRTUALIZE_ABOVE } from "../dashboard/CardGrid.js";
import { DashboardToolbar } from "../dashboard/DashboardToolbar.js";
import { NodeCard } from "../dashboard/NodeCard.js";
import { useDashboardPrefs } from "../dashboard/prefs.js";
import { StatusStrip } from "../dashboard/StatusStrip.js";
import { useToggleFavorite } from "../dashboard/useFavorite.js";
import { arrangeCards, type Density } from "../dashboard/view.js";
import { useDashboard } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";

export function DashboardPage() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data, isPending, isError } = useDashboard(connectionId);
  const [prefs, setPrefs] = useDashboardPrefs();
  const [query, setQuery] = useState("");
  const now = useNow();
  const toggleFavorite = useToggleFavorite(connectionId);
  const onFavorite = useCallback(
    (num: number, favorite: boolean) => {
      void toggleFavorite(num, favorite);
    },
    [toggleFavorite],
  );

  const cards = data?.nodes;
  const large = (cards?.length ?? 0) > VIRTUALIZE_ABOVE;
  // Compact by default on big meshes, until the user picks a density.
  const density: Density = prefs.density ?? (large ? "compact" : "comfy");
  const thresholds = data?.thresholds;

  const sections = useMemo(
    () =>
      cards && thresholds
        ? arrangeCards(cards, { query, filter: prefs.filter, sort: prefs.sort, now, thresholds })
        : null,
    [cards, thresholds, query, prefs.filter, prefs.sort, now],
  );
  const origin = cards?.find((c) => c.isSelf)?.position ?? null;

  const renderCard = useCallback(
    (card: NodeCardData) =>
      thresholds ? (
        <NodeCard
          card={card}
          origin={origin}
          now={now}
          thresholds={thresholds}
          density={density}
          onFavorite={onFavorite}
        />
      ) : null,
    [origin, now, thresholds, density, onFavorite],
  );

  const shown = sections
    ? (sections.self ? 1 : 0) + sections.favorites.length + sections.others.length
    : 0;

  return (
    <section data-mt="dashboard" data-mt-variant={density}>
      <h1 data-mt="page-title">Dashboard</h1>
      {connectionId === null || isPending ? (
        <p data-mt="dashboard-waiting">Loading dashboard…</p>
      ) : isError ? (
        <p data-mt="dashboard-error" role="alert">
          The dashboard couldn&apos;t be loaded.
        </p>
      ) : (
        <>
          <StatusStrip
            data={data}
            onShowOnline={() => {
              setPrefs({ filter: "online" });
            }}
          />
          <DashboardToolbar
            query={query}
            onQuery={setQuery}
            filter={prefs.filter}
            onFilter={(filter) => {
              setPrefs({ filter });
            }}
            sort={prefs.sort}
            onSort={(sort) => {
              setPrefs({ sort });
            }}
            density={density}
            onDensity={(d) => {
              setPrefs({ density: d });
            }}
          />
          {data.nodes.length === 0 ? (
            <div data-mt="dashboard-empty">
              <h2 data-mt="dashboard-empty-title">No nodes yet</h2>
              <p>
                The node list fills in once MeshTerm finishes the config handshake with your node,
                and grows as other nodes are heard on the mesh.
              </p>
            </div>
          ) : shown === 0 || !sections ? (
            <p data-mt="dashboard-no-match">No nodes match the search and filter.</p>
          ) : (
            <CardGrid sections={sections} renderCard={renderCard} virtualize={large} />
          )}
        </>
      )}
    </section>
  );
}
