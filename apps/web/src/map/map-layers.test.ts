import {
  DEFAULT_DASHBOARD_THRESHOLDS,
  type MapNodeFeature,
  type MapNodeProperties,
  type MapNodesDTO,
} from "@meshterm/shared";
import { afterEach, describe, expect, it } from "vitest";
import { haversineMeters } from "../dashboard/geo.js";
import {
  DEFAULT_LAYER_PREFS,
  destination,
  directLinks,
  LAYER_PREFS_KEY,
  nearestNodes,
  rangeRings,
  RING_KM,
  readLayerPrefs,
  writeLayerPrefs,
} from "./map-layers.js";
import { buildStyle, LAYER, pinSize } from "./map-style.js";
import { readMapTokens } from "./map-tokens.js";

const NOW = 1_800_000_000_000;
const SELF: [number, number] = [-122.3, 47.6];

function node(
  num: number,
  coordinates: [number, number],
  over: Partial<MapNodeProperties> = {},
): MapNodeFeature {
  return {
    type: "Feature",
    id: num,
    geometry: { type: "Point", coordinates },
    properties: {
      num,
      userId: `!${num.toString(16).padStart(8, "0")}`,
      shortName: `N${num}`,
      longName: `Node ${num}`,
      role: "CLIENT",
      status: "online",
      lastHeard: NOW - 60_000,
      isSelf: false,
      isFavorite: false,
      precisionMeters: null,
      batteryLevel: null,
      hopsAway: 0,
      snr: 5,
      positionTime: NOW,
      ...over,
    },
  };
}

const dto = (features: MapNodeFeature[]): MapNodesDTO => ({
  type: "FeatureCollection",
  features,
  unplaced: [],
  thresholds: DEFAULT_DASHBOARD_THRESHOLDS,
});

const self = node(1, SELF, { isSelf: true, hopsAway: null, snr: null });
const latLon = ([lon, lat]: [number, number]) => ({ lat, lon });

describe("directLinks", () => {
  it("joins my node to the nodes heard directly, colored by SNR", () => {
    const data = dto([
      self,
      node(2, [-122.25, 47.62], { snr: 7.25 }),
      node(3, [-122.2, 47.7], { snr: -10 }),
      node(4, [-122.1, 47.7], { hopsAway: 2 }),
      node(5, [-122.1, 47.5], { hopsAway: null }),
      node(6, [-122.4, 47.5], { snr: null }),
    ]);
    const links = directLinks(data).features;
    expect(links.map((l) => l.properties.num)).toEqual([2, 3, 6]);
    expect(links[0]?.geometry.coordinates).toEqual([SELF, [-122.25, 47.62]]);
    expect(links.map((l) => l.properties.quality)).toEqual(["good", "poor", "unknown"]);
    expect(links.map((l) => l.properties.label)).toEqual(["7.25 dB", "-10 dB", ""]);
  });

  it("draws nothing without my node's position", () => {
    expect(directLinks(dto([node(2, [-122.25, 47.62])])).features).toEqual([]);
  });
});

describe("rangeRings", () => {
  it("rings of 2, 5 and 10 km around my node, closed, each with a label at north", () => {
    const { rings, labels } = rangeRings(dto([self, node(2, [-122.25, 47.62])]));
    expect(rings.features.map((r) => r.properties.label)).toEqual(["2 km", "5 km", "10 km"]);
    rings.features.forEach((ring, i) => {
      const coords = ring.geometry.coordinates;
      expect(coords[0]).toEqual(coords[coords.length - 1]);
      for (const point of coords) {
        expect(haversineMeters(latLon(SELF), latLon(point))).toBeCloseTo(
          (RING_KM[i] ?? 0) * 1000,
          -1,
        );
      }
    });
    const north = labels.features[1]?.geometry.coordinates ?? [0, 0];
    expect(north[0]).toBeCloseTo(SELF[0], 6);
    expect(north[1]).toBeGreaterThan(SELF[1]);
  });

  it("none without my node's position", () => {
    const { rings, labels } = rangeRings(dto([node(2, [-122.25, 47.62])]));
    expect(rings.features).toHaveLength(0);
    expect(labels.features).toHaveLength(0);
  });

  it("destination wraps across the antimeridian", () => {
    const [lon] = destination([179.99, 0], 5000, 90);
    expect(lon).toBeLessThan(-179.9);
  });
});

describe("nearestNodes", () => {
  it("everyone but me, nearest first, with distance and direction", () => {
    const far = node(3, [-122.0, 47.6]);
    const near = node(2, [-122.3, 47.65]);
    const entries = nearestNodes(dto([self, far, near]));
    expect(entries.map((e) => e.feature.id)).toEqual([2, 3]);
    expect(entries[0]?.where).toBe("5.6 km N");
    expect(entries[1]?.where).toMatch(/^2\d km E$/);
  });

  it("without my position: most recently heard first, no distance", () => {
    const old = node(2, [-122.3, 47.65], { lastHeard: NOW - 3600_000 });
    const fresh = node(3, [-122.0, 47.6], { lastHeard: NOW });
    const entries = nearestNodes(dto([old, fresh]));
    expect(entries.map((e) => e.feature.id)).toEqual([3, 2]);
    expect(entries[0]?.where).toBeNull();
  });
});

describe("layer toggles", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("are remembered, and default to on", () => {
    expect(readLayerPrefs()).toEqual(DEFAULT_LAYER_PREFS);
    writeLayerPrefs({ links: false, rings: true });
    expect(localStorage.getItem(LAYER_PREFS_KEY)).toBe('{"links":false,"rings":true}');
    expect(readLayerPrefs()).toEqual({ links: false, rings: true });
  });

  it("ignore junk", () => {
    localStorage.setItem(LAYER_PREFS_KEY, '{"links":"no"}');
    expect(readLayerPrefs()).toEqual(DEFAULT_LAYER_PREFS);
    localStorage.setItem(LAYER_PREFS_KEY, "{");
    expect(readLayerPrefs()).toEqual(DEFAULT_LAYER_PREFS);
  });

  it("start hidden layers hidden in the style", () => {
    const style = buildStyle("http://x", readMapTokens(), null, { links: false, rings: true });
    const visibility = (id: string) => {
      const layer = style.layers.find((l) => l.id === id);
      return layer && "layout" in layer ? layer.layout.visibility : undefined;
    };
    expect(visibility(LAYER.links)).toBe("none");
    expect(visibility(LAYER.linkLabels)).toBe("none");
    expect(visibility(LAYER.rings)).toBe("visible");
  });
});

describe("pins", () => {
  it("are teardrop symbols under the labels; the selected one grows", () => {
    const style = buildStyle("http://x", readMapTokens());
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf(LAYER.rings)).toBeLessThan(ids.indexOf(LAYER.links));
    expect(ids.indexOf(LAYER.links)).toBeLessThan(ids.indexOf(LAYER.nodes));
    expect(ids.indexOf(LAYER.nodes)).toBeLessThan(ids.indexOf(LAYER.labels));
    const pins = style.layers.find((l) => l.id === LAYER.nodes);
    expect(pins?.type).toBe("symbol");
    expect(pinSize(42)).toEqual([
      "case",
      ["==", ["get", "num"], 42],
      1.35,
      ["get", "isSelf"],
      1.1,
      1,
    ]);
  });
});
