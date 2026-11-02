import { nodeNumFromId, type MapNodeFeature } from "@meshterm/shared";
import { useSearch } from "@tanstack/react-router";
import { Crosshair, Maximize2, Minus, Plus, Radar, Spline } from "lucide-react";
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import { useNow } from "../components/useNow.js";
import { formatAgo } from "../dashboard/format.js";
import { nodeStatus } from "../dashboard/view.js";
import { useMapNodes } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { openNodeDetails } from "../data/ui-store.js";
import { boundsOf, readViewport, toMapSource, writeViewport } from "./map-data.js";
import {
  directLinks,
  nearestNodes,
  rangeRings,
  readLayerPrefs,
  writeLayerPrefs,
  type LayerPrefs,
} from "./map-layers.js";
import { MapSheet } from "./MapSheet.js";
import {
  applyBaseLayers,
  buildStyle,
  LAYER,
  LINK_SOURCE,
  MAX_ZOOM,
  NODE_SOURCE,
  pinSize,
  RING_LABEL_SOURCE,
  RING_SOURCE,
  TOGGLE_LAYERS,
  tokenPaint,
} from "./map-style.js";
import { useThemeStore } from "../theme/store.js";
import { useThemeChange } from "../components/useThemeChange.js";
import { drawLabel, drawPin, readMapTokens, type MapTokens } from "./map-tokens.js";
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

/** The image for `mt-pin-<status>` / `mt-pin-self`, from the current tokens. */
function pinImage(id: string, tokens: MapTokens) {
  const key = id.slice("mt-pin-".length);
  const fill =
    key === "self"
      ? tokens.self
      : key in tokens.status
        ? tokens.status[key as keyof MapTokens["status"]]
        : null;
  return fill === null ? null : drawPin(fill, tokens);
}

/** North is always up (rotation is off); the compass says so. */
function Compass() {
  return (
    <div data-mt="map-compass" role="img" aria-label="North is up">
      <svg viewBox="0 0 24 24" aria-hidden focusable={false}>
        <path data-mt-variant="north" d="M12 3 16 12H8z" />
        <path data-mt-variant="south" d="M12 21 8 12h8z" />
      </svg>
      <span data-mt="map-compass-label" aria-hidden>
        N
      </span>
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
  const [layers, setLayers] = useState<LayerPrefs>(readLayerPrefs);
  const layersRef = useRef(layers);

  // Create the map once; it becomes usable (state) when its style has loaded.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !supported) return;
    const tokens = readMapTokens();
    tokensRef.current = tokens;
    const saved = readViewport();
    const instance = new MapLibreMap({
      container,
      style: buildStyle(
        window.location.origin,
        tokens,
        useThemeStore.getState().mapStyle,
        layersRef.current,
      ),
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
      const image = id.startsWith("mt-pin-")
        ? pinImage(id, t)
        : id.startsWith("mt-count-")
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
      const { rings, labels } = rangeRings(data);
      void map.getSource<GeoJSONSource>(LINK_SOURCE)?.setData(directLinks(data));
      void map.getSource<GeoJSONSource>(RING_SOURCE)?.setData(rings);
      void map.getSource<GeoJSONSource>(RING_LABEL_SOURCE)?.setData(labels);
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

  // The selected pin grows.
  useEffect(() => {
    map?.setLayoutProperty(LAYER.nodes, "icon-size", pinSize(selected));
  }, [map, selected]);

  // Layer toggles, remembered in this browser.
  useEffect(() => {
    layersRef.current = layers;
    writeLayerPrefs(layers);
    if (!map) return;
    for (const key of ["links", "rings"] as const) {
      for (const id of TOGGLE_LAYERS[key]) {
        map.setLayoutProperty(id, "visibility", layers[key] ? "visible" : "none");
      }
    }
  }, [map, layers]);

  useThemeChange(() => {
    if (!map) return;
    const tokens = readMapTokens();
    tokensRef.current = tokens;
    applyTheme(map, tokens);
  });

  // The theme's base map (CR-004 §8.3): swapped in place, so the camera and nodes stay.
  const mapStyle = useThemeStore((s) => s.mapStyle);
  const appliedStyle = useRef(useThemeStore.getState().mapStyle);
  useEffect(() => {
    if (!map || appliedStyle.current === mapStyle) return;
    appliedStyle.current = mapStyle;
    applyBaseLayers(map, mapStyle);
  }, [map, mapStyle]);

  const fitAll = () => {
    const bounds = data ? boundsOf(data.features) : null;
    if (map && bounds) map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM });
  };
  const self = data?.features.find((f) => f.properties.isSelf) ?? null;
  const selectedFeature = data?.features.find((f) => f.id === selected) ?? null;
  const nearest = data ? nearestNodes(data) : [];
  const focus = (feature: MapNodeFeature) => {
    if (!map) return;
    map.flyTo({
      center: feature.geometry.coordinates,
      zoom: Math.max(map.getZoom(), NODE_ZOOM),
    });
    setSelected(feature.id);
  };
  const toggle = (key: keyof LayerPrefs) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  };
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
      <div data-mt="map-tools" role="toolbar" aria-label="Map controls">
        <div data-mt="map-tools-group" data-mt-variant="view">
          <button
            type="button"
            data-mt="map-button"
            data-mt-variant="zoom-in"
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
            data-mt-variant="zoom-out"
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
            data-mt-variant="my-node"
            aria-label="My node"
            title="My node"
            disabled={!map || !self}
            onClick={() => {
              if (self) focus(self);
            }}
          >
            <Crosshair data-mt="icon" aria-hidden focusable={false} />
          </button>
          <button
            type="button"
            data-mt="map-button"
            data-mt-variant="fit"
            aria-label="Fit all nodes"
            title="Fit all"
            disabled={!map || !data?.features.length}
            onClick={fitAll}
          >
            <Maximize2 data-mt="icon" aria-hidden focusable={false} />
          </button>
        </div>
        <div data-mt="map-tools-group" data-mt-variant="layers" aria-label="Layers" role="group">
          <button
            type="button"
            data-mt="map-button"
            data-mt-variant="links"
            data-mt-state={layers.links ? "on" : "off"}
            aria-pressed={layers.links}
            aria-label="Direct links"
            title="Direct links (SNR)"
            onClick={() => {
              toggle("links");
            }}
          >
            <Spline data-mt="icon" aria-hidden focusable={false} />
          </button>
          <button
            type="button"
            data-mt="map-button"
            data-mt-variant="rings"
            data-mt-state={layers.rings ? "on" : "off"}
            aria-pressed={layers.rings}
            aria-label="Range rings"
            title="Range rings (2, 5, 10 km)"
            onClick={() => {
              toggle("rings");
            }}
          >
            <Radar data-mt="icon" aria-hidden focusable={false} />
          </button>
        </div>
      </div>
      <Compass />
      {nearest.length > 0 && (
        <aside data-mt="map-nearest" aria-labelledby="map-nearest-title">
          <h2 id="map-nearest-title" data-mt="map-nearest-title">
            Nearest first
          </h2>
          <ul data-mt="map-nearest-list">
            {nearest.map(({ feature, where }) => {
              const p = feature.properties;
              const status = data ? nodeStatus(p.lastHeard, now, data.thresholds) : "offline";
              return (
                <li key={feature.id}>
                  <button
                    type="button"
                    data-mt="map-nearest-item"
                    data-mt-state={status}
                    data-node-num={p.num}
                    aria-current={selected === feature.id ? "true" : undefined}
                    onClick={() => {
                      focus(feature);
                    }}
                  >
                    <span data-mt="status-dot" data-mt-state={status} aria-hidden />
                    <span data-mt="node-short-name">{p.shortName || p.userId.slice(-4)}</span>
                    <span data-mt="map-nearest-name">{p.longName || p.userId}</span>
                    <span data-mt="map-nearest-distance">{where ?? ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      )}
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
        <MapSheet
          connectionId={connectionId}
          feature={selectedFeature}
          where={nearest.find((e) => e.feature.id === selectedFeature.id)?.where ?? null}
          thresholds={data.thresholds}
          now={now}
          onCenter={() => {
            focus(selectedFeature);
          }}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
      <div data-mt="map-attribution">
        ©{" "}
        <a
          data-mt="map-attribution-link"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>{" "}
        contributors
      </div>
    </section>
  );
}
