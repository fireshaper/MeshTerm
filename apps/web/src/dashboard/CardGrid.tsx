import type { NodeCard as NodeCardData } from "@meshterm/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Sections } from "./view.js";

/** Above this many cards the grid renders only the rows near the viewport. */
export const VIRTUALIZE_ABOVE = 150;

type SectionId = "self" | "favorites" | "all";

const SECTION_TITLES: Record<SectionId, string> = {
  self: "My node",
  favorites: "Favorites",
  all: "All nodes",
};

function sectionList(sections: Sections): { id: SectionId; cards: NodeCardData[] }[] {
  const list: { id: SectionId; cards: NodeCardData[] }[] = [];
  if (sections.self) list.push({ id: "self", cards: [sections.self] });
  if (sections.favorites.length) list.push({ id: "favorites", cards: sections.favorites });
  if (sections.others.length) list.push({ id: "all", cards: sections.others });
  return list;
}

function SectionTitle({ id, count }: { id: SectionId; count: number }) {
  return (
    <h2 data-mt="card-section-title" data-mt-variant={id}>
      {SECTION_TITLES[id]}
      {id !== "self" && <span data-mt="card-section-count"> {count}</span>}
    </h2>
  );
}

interface CardGridProps {
  sections: Sections;
  renderCard: (card: NodeCardData) => ReactNode;
  virtualize: boolean;
}

/** My node, then favorites, then everyone else, each as a responsive card grid. */
export function CardGrid({ sections, renderCard, virtualize }: CardGridProps) {
  const list = sectionList(sections);
  if (virtualize) return <VirtualCardGrid list={list} renderCard={renderCard} />;
  return (
    <div data-mt="card-sections">
      {list.map(({ id, cards }) => (
        <section key={id} data-mt="card-section" data-mt-variant={id}>
          <SectionTitle id={id} count={cards.length} />
          <ul data-mt="card-grid">
            {cards.map((card) => (
              <li key={card.num} data-mt="card-cell">
                {renderCard(card)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

type Row =
  | { kind: "title"; key: string; id: SectionId; count: number }
  | { kind: "cards"; key: string; cards: NodeCardData[] };

/** Columns the CSS grid resolves to at the current width (1 where layout is unknown). */
function useColumns(ref: React.RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/);
      const count = tracks.filter((t) => /^\d/.test(t)).length;
      setColumns(Math.max(1, count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return columns;
}

/**
 * Row virtualization for big meshes: section titles and card rows are virtual items
 * in the page's scroll container (`[data-mt=main]`). A hidden probe grid with the same
 * CSS tells how many columns fit.
 */
function VirtualCardGrid({
  list,
  renderCard,
}: {
  list: { id: SectionId; cards: NodeCardData[] }[];
  renderCard: (card: NodeCardData) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const columns = useColumns(probeRef);
  const [scrollMargin, setScrollMargin] = useState(0);

  const rows: Row[] = [];
  for (const { id, cards } of list) {
    rows.push({ kind: "title", key: `title-${id}`, id, count: cards.length });
    for (let i = 0; i < cards.length; i += columns) {
      const chunk = cards.slice(i, i + columns);
      rows.push({ kind: "cards", key: `${id}-${String(chunk[0]?.num)}`, cards: chunk });
    }
  }

  const scrollElement = () =>
    containerRef.current?.closest<HTMLElement>('[data-mt="main"]') ?? null;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const scroller = scrollElement();
    if (!container || !scroller) return;
    setScrollMargin(
      container.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop,
    );
  }, []);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns fresh functions by design
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: scrollElement,
    estimateSize: (i) => (rows[i]?.kind === "title" ? 48 : 240),
    getItemKey: (i) => rows[i]?.key ?? i,
    overscan: 3,
    scrollMargin,
  });

  return (
    <div data-mt="card-sections" data-mt-variant="virtual" ref={containerRef}>
      <div data-mt="card-grid" data-mt-variant="probe" ref={probeRef} aria-hidden />
      <div data-mt="virtual-space" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              data-mt="virtual-row"
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
            >
              {row.kind === "title" ? (
                <SectionTitle id={row.id} count={row.count} />
              ) : (
                <ul data-mt="card-grid">
                  {row.cards.map((card) => (
                    <li key={card.num} data-mt="card-cell">
                      {renderCard(card)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
