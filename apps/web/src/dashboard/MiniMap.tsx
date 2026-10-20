import type { CardPosition } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { MapPinOff } from "lucide-react";
import { mosaicFor, tileUrl } from "./geo.js";

const pct = (fraction: number) => `${Number((fraction * 100).toFixed(3))}%`;

/**
 * A small static map: a 3×2 mosaic of 256 px tiles from the server's tile proxy,
 * shifted so the node sits at the center, with a pin and (for coarsened positions)
 * a precision circle. No WebGL, so hundreds of cards are fine.
 */
export function MiniMap({
  position,
  isSelf,
  num,
  onOpen,
}: {
  position: CardPosition | null;
  isSelf: boolean;
  /** When given, the map links to the Map page centered on this node. */
  num?: number;
  onOpen?: () => void;
}) {
  if (!position) {
    return (
      <div data-mt="mini-map" data-mt-state="empty">
        <MapPinOff data-mt="icon" aria-hidden focusable={false} />
        <span data-mt="mini-map-placeholder">No position shared</span>
      </div>
    );
  }
  const mosaic = mosaicFor(position, position.precisionBits);
  return (
    <div
      data-mt="mini-map"
      data-mt-state="ready"
      data-mt-variant={isSelf ? "self" : "node"}
      role="img"
      aria-label={`Map at ${position.lat.toFixed(4)}, ${position.lon.toFixed(4)}`}
      style={{ "--mt-map-x": pct(mosaic.pointX), "--mt-map-y": pct(mosaic.pointY) }}
    >
      <div data-mt="mini-map-tiles">
        {mosaic.tiles.map(({ x, y }) => (
          <img
            key={`${x}/${y}`}
            src={tileUrl(mosaic.z, x, y)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ))}
      </div>
      {mosaic.precisionDiameter !== null && (
        <span
          data-mt="mini-map-precision"
          style={{ "--mt-map-precision": String(Number(mosaic.precisionDiameter.toFixed(4))) }}
        />
      )}
      <svg data-mt="mini-map-marker" viewBox="0 0 24 24" aria-hidden focusable={false}>
        <path
          d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"
          fill="currentColor"
          stroke="var(--mt-surface-bg)"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="10" r="2.5" fill="var(--mt-surface-bg)" />
      </svg>
      {num !== undefined && (
        <Link
          to="/map"
          search={{ node: num }}
          data-mt="mini-map-link"
          aria-label="Open on the map"
          title="Open on the map"
          onClick={onOpen}
        />
      )}
    </div>
  );
}
