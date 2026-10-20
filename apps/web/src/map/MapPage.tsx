import { nodeNumFromId, type MapNodeFeature } from "@meshterm/shared";
import { useSearch } from "@tanstack/react-router";
import { Crosshair, Maximize2, Minus, PanelRightOpen, Plus, X } from "lucide-react";
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import { useNow } from "../components/useNow.js";
import { formatAbsolute, formatAgo } from "../dashboard/format.js";
import { nodeStatus } from "../dashboard/view.js";
import { useMapNodes } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { openNodeDetails } from "../data/ui-store.js";
import { boundsOf, readViewport, toMapSource, writeViewport } from "./map-data.js";
import { buildStyle, LAYER, MAX_ZOOM, NODE_SOURCE, tokenPaint } from "./map-style.js";
import { useThemeChange } from "../components/useThemeChange.js";
import { drawLabel, readMapTokens, type MapTokens } from "./map-tokens.js";
import "./map.css";

// A same-origin module worker: allowed by the CSP's worker-src 'self' (no blob: URL).
setWorkerUrl(workerUrl);

/** The map source is updated at most this often (spec: once per second). */
export const SET_DATA_INTERVAL_MS = 1_000;
const NODE_ZOOM = 13;
const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 15;

declare global {
  interface Window {
    /** The live map, for end-to-end tests and debugging. */
    __meshtermMap?: MapLibreMap;
  }
}

/** WebGL is what MapLibre needs; checked once, before trying to create a map. */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Recolors layers and drops label images (they are redrawn with the new tokens). */
function applyTheme(map: MapLibreMap, tokens: MapTokens): void {
  for (const [layer, paint] of Object.entries(tokenPaint(tokens))) {
    for (const [prop, value] of Object.entries(paint)) {
      map.setPaintProperty(layer, prop as never, value as never);
    }
  }
  for (const id of map.listImages()) if (id.startsWith("mt-")) map.removeImage(id);
  map.triggerRepaint();
}

function Popover({
  feature,
  status,
  map,
  now,
  onClose,
}: {
  feature: MapNodeFeature;
  status: string;
  map: MapLibreMap;
  now: number;
  onClose: () => void;
}) {
  const [point, setPoint] = useState(() => map.project(feature.geometry.coordinates));
  useEffect(() => {
    const update = () => {
      setPoint(map.project(feature.geometry.coordinates));
    };
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map, feature]);
  const p = feature.properties;
  const level = p.batteryLevel;
  return (
    <div
      data-mt="map-popover"
      role="dialog"
      aria-label={p.longName || p.shortName || p.userId}
      data-node-num={p.num}
      style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
    >
      <div data-mt="map-popover-card">
        <header data-mt="map-popover-header">
          <span data-mt="status-dot" data-mt-state={status} aria-hidden />
          <span data-mt="map-popover-title">{p.longName || p.userId}</span>
          <span data-mt="node-short-name">{p.shortName}</span>
          <button type="button" data-mt="icon-button" aria-label="Close" onClick={onClose}>
            <X data-mt="icon" aria-hidden focusable={false} />
          </button>
        </header>
        <dl data-mt="map-popover-fields">
          <div>
            <dt>ID</dt>
            <dd data-mt="node-id">{p.userId}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>
              {p.lastHeard === null ? (
                "Never"
              ) : (
                <time
                  dateTime={new Date(p.lastHeard).toISOString()}
                  title={formatAbsolute(p.lastHeard)}
                >
                  {formatAgo(p.lastHeard, now)}
                </time>
              )}
            </dd>
          </div>
          <div>
            <dt>Battery</dt>
            <dd>{level === null ? "Unknown" : level > 100 ? "External power" : `${level}%`}</dd>
          </div>
          <div>
            <dt>Hops</dt>
            <dd>
              {p.isSelf
                ? "My node"
                : p.hopsAway === null
                  ? "Unknown"
                  : p.hopsAway === 0
                    ? "Heard directly"
                    : `${p.hopsAway} ${p.hopsAway === 1 ? "hop" : "hops"}`}
            </dd>
          </div>
          {p.precisionMeters !== null && (
            <div>
              <dt>Position</dt>
              <dd>Approximate (±{Math.round(p.precisionMeters / 100) / 10} km)</dd>
            </div>
          )}
        </dl>
        <button
          type="button"
          data-mt="button"
          data-mt-variant="details"
          onClick={() => {
            openNodeDetails(p.num);
          }}
        >
          <PanelRightOpen data-mt="icon" aria-hidden focusable={false} />
          Details
        </button>
      </div>
    </div>
  );
}

/** The mesh on a pannable, zoomable OpenStreetMap; every node ever seen with a position. */
export function MapPage() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data, isError } = useMapNodes(connectionId);
  const search: { focus?: string } = useSearch({ strict: false });
  const deepNode = search.focus ? nodeNumFromId(search.focus) : null;
  const now = useNow();
  const containerRef = useRef<HTMLDivElement>(null);
  const tokensRef = useRef<MapTokens | null>(null);
  const placedRef = useRef(false);
  const lastSetRef = useRef(0);
  const [supported] = useState(webglAvailable);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [selected, setSelected] = useState<number | null>(deepNode);
  const [showUnplaced, setShowUnplaced] = useState(false);

  // Create the map once; it becomes usable (state) when its style has loaded.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !supported) return;
    const tokens = readMapTokens();
    tokensRef.current = tokens;
    const saved = readViewport();
    const instance = new MapLibreMap({
      container,
      style: buildStyle(window.location.origin, tokens),
      center: saved?.center ?? [0, 20],
      zoom: saved?.zoom ?? 1.5,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    instance.touchZoomRotate.disableRotation();

    // Labels and cluster counts are drawn on demand (no glyph server needed).
    instance.setMissingStyleImageResolver((id) => {
      const t = tokensRef.current;
      if (!t || instance.hasImage(id)) return;
      const image = id.startsWith("mt-count-")
        ? drawLabel(id.slice("mt-count-".length), t, { bold: true, halo: false, size: 12 })
        : id.startsWith("mt-label-")
          ? drawLabel(id.slice("mt-label-".length), t)
          : null;
      if (image) {
        instance.addImage(
          id,
          { width: image.width, height: image.height, data: image.data },
          { pixelRatio: image.pixelRatio },
        );
      }
    });

    instance.on("click", LAYER.clusters, (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const clusterId: unknown = feature?.properties.cluster_id;
      const source = instance.getSource<GeoJSONSource>(NODE_SOURCE);
      if (typeof clusterId !== "number" || !source) return;
      const center = e.lngLat;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        instance.easeTo({ center, zoom });
      });
    });
    instance.on("click", LAYER.nodes, (e: MapLayerMouseEvent) => {
      const num: unknown = e.features?.[0]?.properties.num;
      if (typeof num === "number") setSelected(num);
    });
    instance.on("click", (e) => {
      const hits = instance.queryRenderedFeatures(e.point, {
        layers: [LAYER.nodes, LAYER.clusters],
      });
      if (hits.length === 0) setSelected(null);
    });
    for (const layer of [LAYER.nodes, LAYER.clusters]) {
      instance.on("mouseenter", layer, () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", layer, () => {
        instance.getCanvas().style.cursor = "";
      });
    }
    instance.on("moveend", () => {
      if (!placedRef.current) return;
      const c = instance.getCenter();
      writeViewport({ center: [c.lng, c.lat], zoom: instance.getZoom() });
    });
    instance.on("load", () => {
      window.__meshtermMap = instance;
      setMap(instance);
    });

    return () => {
      if (window.__meshtermMap === instance) delete window.__meshtermMap;
      instance.remove();
    };
  }, [supported]);

  // Node data into the source, at most once per second (statuses follow the clock).
  useEffect(() => {
    if (!map || !data) return;
    const push = () => {
      lastSetRef.current = Date.now();
      void map.getSource<GeoJSONSource>(NODE_SOURCE)?.setData(toMapSource(data, now));
    };
    const wait = lastSetRef.current + SET_DATA_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      push();
      return;
    }
    const timer = setTimeout(push, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [map, data, now]);

  // First data: the deep-linked node, else the remembered view, else fit everything.
  useEffect(() => {
    if (!map || !data || placedRef.current) return;
    placedRef.current = true;
    const target = deepNode === null ? null : data.features.find((f) => f.id === deepNode);
    if (target) {
      map.jumpTo({ center: target.geometry.coordinates, zoom: NODE_ZOOM });
      return;
    }
    if (readViewport()) return;
    const bounds = boundsOf(data.features);
    if (bounds) {
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: 0 });
    }
  }, [map, data, deepNode]);

  useThemeChange(() => {
    if (!map) return;
    const tokens = readMapTokens();
    tokensRef.current = tokens;
    applyTheme(map, tokens);
  });

  const fitAll = () => {
    const bounds = data ? boundsOf(data.features) : null;
    if (map && bounds) map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM });
  };
  const self = data?.features.find((f) => f.properties.isSelf) ?? null;
  const selectedFeature = data?.features.find((f) => f.id === selected) ?? null;
  const unplaced = data?.unplaced ?? [];
  const state = !supported ? "unsupported" : isError ? "error" : map ? "ready" : "loading";

  return (
    <section data-mt="map-view" data-mt-state={state} aria-label="Map">
      <h1 data-mt="visually-hidden">Map</h1>
      <div data-mt="map-canvas" ref={containerRef} />
      {!supported && (
        <p data-mt="map-unsupported" role="alert">
          This browser can&apos;t show the map (WebGL is unavailable).
        </p>
      )}
      {isError && (
        <p data-mt="map-error" role="alert">
          Map data couldn&apos;t be loaded.
        </p>
      )}
      <div data-mt="map-toolbar" role="toolbar" aria-label="Map controls">
        <button
          type="button"
          data-mt="map-button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={!map}
          onClick={() => map?.zoomIn()}
        >
          <Plus data-mt="icon" aria-hidden focusable={false} />
        </button>
        <button
          type="button"
          data-mt="map-button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={!map}
          onClick={() => map?.zoomOut()}
        >
          <Minus data-mt="icon" aria-hidden focusable={false} />
        </button>
        <button
          type="button"
          data-mt="map-button"
          aria-label="Fit all nodes"
          title="Fit all"
          disabled={!map || !data?.features.length}
          onClick={fitAll}
        >
          <Maximize2 data-mt="icon" aria-hidden focusable={false} />
        </button>
        <button
          type="button"
          data-mt="map-button"
          aria-label="My node"
          title="My node"
          disabled={!map || !self}
          onClick={() => {
            if (!map || !self) return;
            map.flyTo({
              center: self.geometry.coordinates,
              zoom: Math.max(map.getZoom(), NODE_ZOOM),
            });
            setSelected(self.id);
          }}
        >
          <Crosshair data-mt="icon" aria-hidden focusable={false} />
        </button>
      </div>
      {unplaced.length > 0 && (
        <div data-mt="map-unplaced">
          <button
            type="button"
            data-mt="map-unplaced-toggle"
            aria-expanded={showUnplaced}
            onClick={() => {
              setShowUnplaced((v) => !v);
            }}
          >
            Not on map ({unplaced.length})
          </button>
          {showUnplaced && (
            <ul data-mt="map-unplaced-list" aria-label="Nodes without a position">
              {unplaced.map((u) => (
                <li key={u.num}>
                  <button
                    type="button"
                    data-mt="map-unplaced-node"
                    onClick={() => {
                      openNodeDetails(u.num);
                    }}
                  >
                    <span>{u.longName || u.userId}</span>
                    <span data-mt="map-unplaced-seen">
                      {u.lastHeard === null ? "never heard" : formatAgo(u.lastHeard, now)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {map && data && selectedFeature && (
        <Popover
          feature={selectedFeature}
          status={nodeStatus(selectedFeature.properties.lastHeard, now, data.thresholds)}
          map={map}
          now={now}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
      <div data-mt="map-attribution">
        ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>{" "}
        contributors
      </div>
    </section>
  );
}
