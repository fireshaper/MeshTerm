import type { NodeCard as NodeCardData } from "@meshterm/shared";
import { useCallback, useMemo, useState } from "react";
import { ColumnPicker, DEFAULT_COLUMNS, NodeTable } from "../components/NodeTable.js";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/Panel.js";
import { useNow } from "../components/useNow.js";
import { CardGrid, VIRTUALIZE_ABOVE } from "../dashboard/CardGrid.js";
import { NodeCard } from "../dashboard/NodeCard.js";
import { NodesToolbar } from "../dashboard/NodesToolbar.js";
import { useNodePrefs } from "../dashboard/prefs.js";
import { useToggleFavorite } from "../dashboard/useFavorite.js";
import { arrangeCards, nodeStatus, type Density } from "../dashboard/view.js";
import { useDashboard } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";

/** The full node inventory: search, filters, sort, and cards or a dense table. */
export function NodesPage() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data, isPending, isError } = useDashboard(connectionId);
  const [prefs, setPrefs] = useNodePrefs();
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
  const thresholds = data?.thresholds;
  const large = (cards?.length ?? 0) > VIRTUALIZE_ABOVE;
  // Compact by default on big meshes, until the user picks a density.
  const density: Density = prefs.density ?? (large ? "compact" : "comfy");
  const columns = prefs.columns ?? DEFAULT_COLUMNS;
  const roles = useMemo(
    () => [...new Set((cards ?? []).flatMap((c) => (c.role ? [c.role] : [])))].sort(),
    [cards],
  );

  const sections = useMemo(
    () =>
      cards && thresholds
        ? arrangeCards(cards, {
            query,
            filter: prefs.filter,
            sort: prefs.sort,
            role: prefs.role,
            power: prefs.power,
            now,
            thresholds,
          })
        : null,
    [cards, thresholds, query, prefs.filter, prefs.sort, prefs.role, prefs.power, now],
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

  const ordered = sections
    ? [...(sections.self ? [sections.self] : []), ...sections.favorites, ...sections.others]
    : [];
  const active =
    cards && thresholds
      ? cards.filter((c) => nodeStatus(c.lastHeard, now, thresholds) === "online").length
      : 0;

  return (
    <section data-mt="node-list" data-mt-variant={prefs.view}>
      <PageHeader
        title="Nodes"
        subtitle={
          cards && thresholds
            ? `${cards.length} known · ${active} heard in the last ${thresholds.onlineMin} min`
            : "Every node in your node database"
        }
      />
      {connectionId === null || isPending ? (
        <p data-mt="node-list-waiting">Loading nodes…</p>
      ) : isError ? (
        <p data-mt="dashboard-error" role="alert">
          The node list couldn&apos;t be loaded.
        </p>
      ) : (
        <>
          <NodesToolbar
            query={query}
            onQuery={setQuery}
            filter={prefs.filter}
            onFilter={(filter) => {
              setPrefs({ filter });
            }}
            roles={roles}
            role={prefs.role}
            onRole={(role) => {
              setPrefs({ role });
            }}
            power={prefs.power}
            onPower={(power) => {
              setPrefs({ power });
            }}
            sort={prefs.sort}
            onSort={(sort) => {
              setPrefs({ sort });
            }}
            view={prefs.view}
            onView={(view) => {
              setPrefs({ view });
            }}
            density={density}
            onDensity={(d) => {
              setPrefs({ density: d });
            }}
          >
            {prefs.view === "table" && (
              <ColumnPicker
                columns={columns}
                onChange={(c) => {
                  setPrefs({ columns: c });
                }}
              />
            )}
          </NodesToolbar>
          {data.nodes.length === 0 ? (
            <div data-mt="dashboard-empty">
              <EmptyState title="No nodes yet">
                The node list fills in once MeshTerm finishes the config handshake with your node.
              </EmptyState>
            </div>
          ) : ordered.length === 0 || !sections || !thresholds ? (
            <p data-mt="dashboard-no-match">No nodes match the search and filters.</p>
          ) : prefs.view === "table" ? (
            <NodeTable
              cards={ordered}
              columns={columns}
              origin={origin}
              now={now}
              thresholds={thresholds}
              onFavorite={onFavorite}
            />
          ) : (
            <div data-mt="node-cards" data-mt-variant={density}>
              <CardGrid sections={sections} renderCard={renderCard} virtualize={large} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
