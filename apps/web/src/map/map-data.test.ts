import { DEFAULT_DASHBOARD_THRESHOLDS, fixtures, type MapNodesDTO } from "@meshterm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyNodeToMap,
  applyPositionToMap,
  applyTelemetryToMap,
  boundsOf,
  readViewport,
  toMapSource,
  VIEWPORT_KEY,
  writeViewport,
} from "./map-data.js";

const NOW = 1_800_000_000_000;
const RIDGE = 0x0badcafe;
const NEW = 0x12345678;

function dto(): MapNodesDTO {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: RIDGE,
        geometry: { type: "Point", coordinates: [-122.28, 47.65] },
        properties: {
          num: RIDGE,
          userId: "!0badcafe",
          shortName: "RDG",
          longName: "Ridge Repeater",
          role: "ROUTER",
          status: "online",
          lastHeard: NOW - 60_000,
          isSelf: false,
          isFavorite: true,
          precisionMeters: null,
          batteryLevel: 101,
          hopsAway: 0,
          snr: 7.25,
          positionTime: NOW - 60_000,
        },
      },
    ],
    unplaced: [
      { num: NEW, userId: "!12345678", shortName: "NEW", longName: "Newcomer", lastHeard: NOW },
    ],
    thresholds: DEFAULT_DASHBOARD_THRESHOLDS,
  };
}

describe("map cache patches", () => {
  it("node.upsert updates a placed node and leaves unchanged data untouched", () => {
    const data = dto();
    const same = applyNodeToMap(data, {
      ...fixtures.node,
      num: RIDGE,
      id: "!0badcafe",
      shortName: "RDG",
      longName: "Ridge Repeater",
      role: "ROUTER",
      lastHeard: NOW - 60_000,
      hopsAway: 0,
      snr: 7.25,
      isFavorite: true,
    });
    expect(same).toBe(data);
    const renamed = applyNodeToMap(data, {
      ...fixtures.node,
      num: RIDGE,
      id: "!0badcafe",
      shortName: "RDG2",
      longName: "Ridge 2",
      lastHeard: NOW,
      hopsAway: 1,
      snr: 2,
      isFavorite: false,
    });
    expect(renamed.features[0]?.properties).toMatchObject({
      shortName: "RDG2",
      lastHeard: NOW,
      hopsAway: 1,
      isFavorite: false,
      batteryLevel: 101,
    });
  });

  it("a position for an unplaced node puts it on the map; a newer one moves it", () => {
    let data = applyPositionToMap(
      dto(),
      {
        connectionId: 1,
        nodeNum: NEW,
        lat: 47.6,
        lon: -122.3,
        altitude: null,
        precisionBits: 13,
        time: NOW,
      },
      null,
    );
    expect(data.unplaced).toEqual([]);
    const fresh = data.features.find((f) => f.id === NEW);
    expect(fresh?.geometry.coordinates).toEqual([-122.3, 47.6]);
    expect(fresh?.properties).toMatchObject({ shortName: "NEW", precisionMeters: 2913 });

    data = applyPositionToMap(
      data,
      {
        connectionId: 1,
        nodeNum: RIDGE,
        lat: 47.7,
        lon: -122.2,
        altitude: 300,
        precisionBits: null,
        time: NOW,
      },
      null,
    );
    expect(data.features.find((f) => f.id === RIDGE)?.geometry.coordinates).toEqual([-122.2, 47.7]);
    // An older report doesn't move it back.
    const older = applyPositionToMap(
      data,
      {
        connectionId: 1,
        nodeNum: RIDGE,
        lat: 1,
        lon: 1,
        altitude: null,
        precisionBits: null,
        time: NOW - 1,
      },
      null,
    );
    expect(older).toBe(data);
  });

  it("a node first heard without a position joins the not-on-map list", () => {
    const data = applyNodeToMap(dto(), {
      ...fixtures.node,
      num: 0x00001111,
      id: "!00001111",
      shortName: "ZZ",
      longName: "Zed",
    });
    expect(data.unplaced.map((u) => u.num)).toEqual([NEW, 0x00001111]);
  });

  it("battery telemetry updates the popup's battery", () => {
    const data = applyTelemetryToMap(dto(), {
      connectionId: 1,
      nodeNum: RIDGE,
      time: NOW,
      kind: "device",
      device: {
        batteryLevel: 55,
        voltage: null,
        channelUtil: null,
        airUtilTx: null,
        uptimeSeconds: null,
      },
    });
    expect(data.features[0]?.properties.batteryLevel).toBe(55);
  });
});

describe("toMapSource", () => {
  it("recomputes status for now, with a rank for clusters and a starred label", () => {
    const later = toMapSource(dto(), NOW + 20 * 60_000);
    expect(later.features[0]?.properties).toEqual({
      num: RIDGE,
      status: "recent",
      rank: 2,
      isSelf: false,
      isFavorite: true,
      label: "★ RDG",
    });
  });
});

describe("boundsOf", () => {
  it("covers every feature", () => {
    const data = applyPositionToMap(
      dto(),
      {
        connectionId: 1,
        nodeNum: NEW,
        lat: 46,
        lon: -121,
        altitude: null,
        precisionBits: null,
        time: NOW,
      },
      null,
    );
    expect(boundsOf(data.features)).toEqual([
      [-122.28, 46],
      [-121, 47.65],
    ]);
    expect(boundsOf([])).toBeNull();
  });
});

describe("viewport storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips and rejects junk", () => {
    writeViewport({ center: [-122, 47], zoom: 9 });
    expect(readViewport()).toEqual({ center: [-122, 47], zoom: 9 });
    localStorage.setItem(VIEWPORT_KEY, JSON.stringify({ center: ["x", 1], zoom: 3 }));
    expect(readViewport()).toBeNull();
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(readViewport()).toBeNull();
    expect(() => {
      writeViewport({ center: [0, 0], zoom: 1 });
    }).not.toThrow();
  });
});
