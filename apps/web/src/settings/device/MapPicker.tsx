import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import { buildStyle, MAX_ZOOM } from "../../map/map-style.js";
import { readMapTokens } from "../../map/map-tokens.js";
import "../../map/map.css";

setWorkerUrl(workerUrl);

const ICON = { "aria-hidden": true, focusable: false } as const;
const PICK_SOURCE = "mt-pick";

export interface LatLon {
  lat: number;
  lon: number;
}

interface MapPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: LatLon | null;
  onPick: (point: LatLon) => void;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

declare global {
  interface Window {
    /** The picker's map, for end-to-end tests. */
    __meshtermPickerMap?: MapLibreMap;
  }
}

/** Click the map to choose a fixed position (CR-002 §5.6). Loaded on demand with MapLibre. */
export function MapPicker({ open, onOpenChange, initial, onPick }: MapPickerProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [point, setPoint] = useState<LatLon | null>(initial);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!container) return;
    const tokens = readMapTokens();
    const style = buildStyle(window.location.origin, tokens);
    const map = new MapLibreMap({
      container,
      style,
      center: initial ? [initial.lon, initial.lat] : [0, 20],
      zoom: initial ? 13 : 1.5,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource(PICK_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: PICK_SOURCE,
        type: "circle",
        source: PICK_SOURCE,
        paint: {
          "circle-radius": 8,
          "circle-color": tokens.self,
          "circle-stroke-width": 2,
          "circle-stroke-color": tokens.labelHalo,
        },
      });
      if (initial) show(map, initial);
      window.__meshtermPickerMap = map;
    });
    map.on("click", (e) => {
      const p = { lat: round(e.lngLat.lat), lon: round(e.lngLat.lng) };
      setPoint(p);
      show(map, p);
    });
    return () => {
      if (window.__meshtermPickerMap === map) delete window.__meshtermPickerMap;
      map.remove();
      mapRef.current = null;
    };
    // The initial point only matters when the map is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content
          data-mt="review-dialog"
          data-mt-variant="map-picker"
          aria-describedby="map-picker-note"
        >
          <header data-mt="review-header">
            <Dialog.Title data-mt="review-title">Pick the fixed position</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" data-mt="icon-button" aria-label="Close">
                <X data-mt="icon" {...ICON} />
              </button>
            </Dialog.Close>
          </header>
          <p data-mt="review-note" id="map-picker-note">
            Click the map where the node is.
          </p>
          <div data-mt="map-picker" ref={setContainer} />
          <footer data-mt="review-actions">
            <output data-mt="map-picker-point">
              {point ? `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}` : "No point chosen"}
            </output>
            <button
              type="button"
              data-mt="button"
              data-mt-variant="primary"
              disabled={!point}
              onClick={() => {
                if (point) onPick(point);
                onOpenChange(false);
              }}
            >
              Use this point
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function show(map: MapLibreMap, p: LatLon): void {
  void map.getSource<GeoJSONSource>(PICK_SOURCE)?.setData({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
  });
}
