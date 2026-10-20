import type { DashboardThresholds, NodeCard } from "@meshterm/shared";
import { useState, type KeyboardEvent } from "react";
import { InfoTip } from "../components/InfoTip.js";
import { EmptyState, Panel } from "../components/Panel.js";
import { useNow } from "../components/useNow.js";
import { useTopology } from "../data/queries.js";
import { openNodeDetails } from "../data/ui-store.js";
import { formatAgo, formatDuration } from "./format.js";
import { signalQuality } from "./insights.js";
import { layoutTopology, RING_LABELS, RING_RADIUS, type PlacedLink } from "./topology.js";
import { nodeStatus } from "./view.js";

const ROUTER_ROLES = new Set(["ROUTER", "ROUTER_LATE", "ROUTER_CLIENT", "REPEATER"]);

const nameOf = (card: NodeCard | undefined, num: number) =>
  card ? card.longName || card.shortName || card.userId : `!${num.toString(16).padStart(8, "0")}`;

/**
 * My node in the middle, other nodes heard recently on rings by the hop count of
 * their last packet. Lines are only links actually observed: my node hearing a node
 * directly, or a node's NeighborInfo report. Routes aren't known, so none are drawn.
 */
export function NetworkMap({
  connectionId,
  cards,
  thresholds,
}: {
  connectionId: number;
  cards: readonly NodeCard[];
  thresholds: DashboardThresholds;
}) {
  const { data, isPending, isError } = useTopology(connectionId);
  const now = useNow();
  const [focus, setFocus] = useState<number | null>(null);
  const byNum = new Map(cards.map((c) => [c.num, c]));

  const body = () => {
    if (isPending) return <div data-mt="skeleton" data-mt-variant="chart" aria-hidden />;
    if (isError) {
      return (
        <p data-mt="network-error" role="alert">
          The network view couldn&apos;t be loaded.
        </p>
      );
    }
    const layout = layoutTopology(data);
    const windowText = formatDuration(data.windowMs / 1000);
    if (layout.nodes.length === 0) {
      return (
        <EmptyState title={`No other nodes heard in the last ${windowText}`}>
          Nodes appear here as their packets reach your node.
        </EmptyState>
      );
    }
    const reported = layout.links.filter((l) => l.kind === "reported").length;
    const describe = (num: number) => {
      const card = byNum.get(num);
      const node = data.nodes.find((n) => n.num === num);
      const direct = layout.links.find((l) => l.kind === "direct" && l.to === num);
      const parts = [
        nameOf(card, num),
        node?.hopsAway === 0
          ? "heard directly"
          : node?.hopsAway == null
            ? "hops unknown"
            : `${node.hopsAway} ${node.hopsAway === 1 ? "hop" : "hops"} away (route unknown)`,
        direct?.snr != null ? `SNR ${direct.snr} dB` : null,
        node?.lastHeard != null ? `heard ${formatAgo(node.lastHeard, now)}` : null,
      ];
      return parts.filter((p) => p !== null).join(" · ");
    };
    const linkTitle = (l: PlacedLink) =>
      l.kind === "direct"
        ? `My node heard ${nameOf(byNum.get(l.to), l.to)} directly${l.snr === null ? "" : ` (SNR ${l.snr} dB)`}`
        : `${nameOf(byNum.get(l.from), l.from)} reports hearing ${nameOf(byNum.get(l.to), l.to)}${l.snr === null ? "" : ` (SNR ${l.snr} dB)`}`;
    const onKey = (num: number) => (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openNodeDetails(num);
      }
    };

    return (
      <figure data-mt="network-map">
        <svg
          viewBox="-104 -104 208 208"
          role="group"
          aria-label={`Network: ${layout.nodes.length} nodes heard in the last ${windowText}, ${layout.links.length - reported} heard directly, ${reported} reported links`}
        >
          {(["direct", "one", "many"] as const).map((ring) => (
            <g key={ring} data-mt="network-ring" data-mt-variant={ring} aria-hidden>
              <circle r={RING_RADIUS[ring]} />
              {/* At -45°, between the evenly spaced nodes (which start at the top). */}
              <text
                x={RING_RADIUS[ring] * Math.SQRT1_2 + 2}
                y={-RING_RADIUS[ring] * Math.SQRT1_2 - 2}
              >
                {RING_LABELS[ring]}
              </text>
            </g>
          ))}
          {layout.links.map((l) => (
            <line
              key={`${l.kind}-${l.from}-${l.to}`}
              data-mt="network-link"
              data-mt-variant={l.kind}
              data-mt-state={signalQuality(l.snr)}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
            >
              <title>{linkTitle(l)}</title>
            </line>
          ))}
          {layout.center !== null && (
            <g data-mt="network-node" data-mt-variant="self" transform="translate(0 0)">
              <circle r="7" />
              <text y="15">{byNum.get(layout.center)?.shortName ?? "Me"}</text>
            </g>
          )}
          {layout.nodes.map((n) => {
            const card = byNum.get(n.num);
            const router = card?.role ? ROUTER_ROLES.has(card.role) : false;
            const node = data.nodes.find((x) => x.num === n.num);
            const status = nodeStatus(node?.lastHeard ?? null, now, thresholds);
            return (
              <g
                key={n.num}
                data-mt="network-node"
                data-mt-variant={[
                  n.ring,
                  router ? "router" : null,
                  card?.isFavorite ? "favorite" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-mt-state={status}
                data-node-num={n.num}
                transform={`translate(${n.x} ${n.y})`}
                role="button"
                tabIndex={0}
                aria-label={describe(n.num)}
                onClick={() => {
                  openNodeDetails(n.num);
                }}
                onKeyDown={onKey(n.num)}
                onMouseEnter={() => {
                  setFocus(n.num);
                }}
                onMouseLeave={() => {
                  setFocus(null);
                }}
                onFocus={() => {
                  setFocus(n.num);
                }}
                onBlur={() => {
                  setFocus(null);
                }}
              >
                {router ? (
                  <rect x="-4" y="-4" width="8" height="8" transform="rotate(45)" />
                ) : (
                  <circle r="4.5" />
                )}
                <text y="11">{card?.shortName ?? n.num.toString(16).slice(-4)}</text>
              </g>
            );
          })}
        </svg>
        <figcaption data-mt="network-caption">
          <span data-mt="network-focus" aria-live="polite">
            {focus === null ? "Select a node for details." : describe(focus)}
          </span>
          <span data-mt="network-legend">
            <span data-mt="network-legend-item" data-mt-variant="direct">
              Heard directly
            </span>
            <span data-mt="network-legend-item" data-mt-variant="reported">
              Reported by NeighborInfo
            </span>
            <span data-mt="network-legend-item" data-mt-variant="router">
              Router / repeater
            </span>
          </span>
          {layout.hidden > 0 && (
            <span data-mt="network-hidden">
              {layout.hidden} more {layout.hidden === 1 ? "node" : "nodes"} not shown.
            </span>
          )}
        </figcaption>
      </figure>
    );
  };

  return (
    <Panel
      variant="network"
      title={
        <>
          Network overview{" "}
          <InfoTip
            label="network overview"
            text="Rings show how many hops each node's last packet took; the actual routes aren't known. Lines are only links actually observed: my node hearing a node directly, or a node's NeighborInfo report."
          />
        </>
      }
    >
      {body()}
    </Panel>
  );
}
