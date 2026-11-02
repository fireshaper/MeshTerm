import type { DashboardThresholds, NodeCard } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { Expand } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { openNodeDetails } from "../data/ui-store.js";
import { baseTileUrl, MapCredit, useBaseMap } from "../map/base-map.js";
import { formatDistance } from "./geo.js";
import { signalQuality, STATUS_LABELS } from "./insights.js";
import { heroFrame, heroHeadline, heroNodes, visibleLabels, type HeroFrame } from "./overview.js";
import { nodeStatus } from "./view.js";

const pct = (fraction: number) => `${Number((fraction * 100).toFixed(3))}%`;
const RING_STEPS_KM = [1, 2, 5, 10, 20, 50, 100, 200];
const DEFAULT_SIZE = { width: 800, height: 540 };

/** Up to two rings (nice kilometer steps) that fit in the frame around my node. */
function ringsFor(frame: HeroFrame): number[] {
  const maxPx = Math.min(frame.width, frame.height) / 2;
  return RING_STEPS_KM.filter((km) => {
    const px = km * 1000 * frame.pxPerMeter;
    return px >= 40 && px <= maxPx;
  }).slice(-2);
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, size] as const;
}

/**
 * The Overview's lead (CR-005 §6.2): my mesh on the base map (static tiles through the
 * tile proxy, like the mini maps), nodes heard in the recent window as pins, range rings
 * and lines to the nodes heard directly, with the headline over it. Pins open the node's
 * details; "Open full map" goes to the Map page.
 */
export function OverviewHero({
  cards,
  thresholds,
  now,
}: {
  cards: readonly NodeCard[];
  thresholds: DashboardThresholds;
  now: number;
}) {
  const [mapRef, size] = useSize<HTMLDivElement>();
  const base = useBaseMap((s) => s.base);
  const titleId = useId();
  const nodes = heroNodes(cards, now, thresholds);
  const self = nodes.find((n) => n.isSelf) ?? null;
  // Until the box is measured (first paint, or no layout at all) frame a typical size.
  const frame = heroFrame(
    nodes.map((n) => n.position),
    size.width || DEFAULT_SIZE.width,
    size.height || DEFAULT_SIZE.height,
  );
  const headline = heroHeadline(cards, now, thresholds);

  // Labels in priority order: my node, favorites, then the most recently heard.
  const ordered = [...nodes].sort(
    (a, b) =>
      Number(b.isSelf) - Number(a.isSelf) ||
      Number(b.isFavorite) - Number(a.isFavorite) ||
      (b.lastHeard ?? 0) - (a.lastHeard ?? 0),
  );
  const placed = frame ? ordered.map((n) => ({ card: n, ...frame.project(n.position) })) : [];
  const labels = visibleLabels(
    placed.map((p) => ({ num: p.card.num, x: p.x, y: p.y, chars: p.card.shortName.length || 4 })),
  );
  const origin = self && frame ? frame.project(self.position) : null;

  return (
    <section data-mt="overview-hero" aria-labelledby={titleId}>
      <div data-mt="overview-hero-map" ref={mapRef}>
        {frame && (
          <>
            <div data-mt="overview-hero-tiles" aria-hidden>
              {frame.tiles.map((t) => (
                <img
                  key={`${t.x}/${t.y}/${t.px}`}
                  src={baseTileUrl(base, frame.z, t.x, t.y)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  style={{
                    "--mt-tile-x": pct(t.px / frame.width),
                    "--mt-tile-y": pct(t.py / frame.height),
                    "--mt-tile-w": pct(256 / frame.width),
                    "--mt-tile-h": pct(256 / frame.height),
                  }}
                />
              ))}
            </div>
            <svg
              data-mt="overview-hero-overlay"
              viewBox={`0 0 ${frame.width} ${frame.height}`}
              aria-hidden
              focusable={false}
            >
              {origin &&
                ringsFor(frame).map((km) => {
                  const r = km * 1000 * frame.pxPerMeter;
                  return (
                    <g key={km} data-mt="map-ring">
                      <circle cx={origin.x} cy={origin.y} r={r} />
                      <text x={origin.x + r * 0.71 + 4} y={origin.y - r * 0.71}>
                        {formatDistance(km * 1000)}
                      </text>
                    </g>
                  );
                })}
              {origin &&
                placed
                  .filter((p) => !p.card.isSelf && p.card.hopsAway === 0)
                  .map((p) => (
                    <line
                      key={p.card.num}
                      data-mt="map-link"
                      data-mt-state={signalQuality(p.card.snr)}
                      x1={origin.x}
                      y1={origin.y}
                      x2={p.x}
                      y2={p.y}
                    />
                  ))}
            </svg>
            <div data-mt="overview-hero-pins">
              {[...placed].reverse().map(({ card, x, y }) => {
                const status = nodeStatus(card.lastHeard, now, thresholds);
                const name = card.longName || card.shortName || card.userId;
                return (
                  <button
                    key={card.num}
                    type="button"
                    data-mt="map-pin"
                    data-mt-state={status}
                    data-mt-variant={card.isSelf ? "self" : "node"}
                    aria-label={`${name}${card.isSelf ? " (my node)" : ""}, ${STATUS_LABELS[status]}`}
                    title={name}
                    style={{
                      "--mt-pin-x": pct(x / frame.width),
                      "--mt-pin-y": pct(y / frame.height),
                    }}
                    onClick={() => {
                      openNodeDetails(card.num);
                    }}
                  >
                    <svg data-mt="map-pin-shape" viewBox="0 0 24 30" aria-hidden focusable={false}>
                      <path d="M12 29s10-9.5 10-17A10 10 0 0 0 2 12c0 7.5 10 17 10 17z" />
                      <circle cx="12" cy="12" r="3.6" />
                    </svg>
                    {labels.has(card.num) && (
                      <span data-mt="map-pin-label">{card.shortName || name}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {!frame && (
          <p data-mt="overview-hero-empty">
            No node has shared a position yet. The map fills in as positions arrive.
          </p>
        )}
      </div>
      <div data-mt="overview-headline">
        <h2 id={titleId} data-mt="overview-headline-title">
          {headline.title}
        </h2>
        <p data-mt="overview-headline-detail">{headline.detail}</p>
      </div>
      <div data-mt="overview-hero-foot">
        <span data-mt="map-legend">
          {(["online", "recent", "stale"] as const).map((s) => (
            <span key={s} data-mt="map-legend-item" data-mt-state={s}>
              <span data-mt="status-dot" data-mt-state={s} aria-hidden />
              {STATUS_LABELS[s]}
            </span>
          ))}
          <span data-mt="map-legend-item" data-mt-variant="link">
            <span data-mt="map-legend-line" aria-hidden />
            Heard directly
          </span>
        </span>
        <Link to="/map" data-mt="button" data-mt-variant="open-map">
          <Expand data-mt="icon" aria-hidden focusable={false} />
          Open full map
        </Link>
      </div>
      <MapCredit base={base} variant="overview" />
    </section>
  );
}
