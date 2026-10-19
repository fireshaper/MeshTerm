import { describe, expect, it } from "vitest";
import {
  bearingDegrees,
  cardinal,
  formatDistance,
  haversineMeters,
  metersPerPixel,
  miniMapZoom,
  mosaicFor,
  precisionRadiusMeters,
  tileCoords,
  tileUrl,
} from "./geo.js";

const SEATTLE = { lat: 47.6062, lon: -122.3321 };
const PORTLAND = { lat: 45.5152, lon: -122.6784 };
const LONDON = { lat: 51.5074, lon: -0.1278 };
const PARIS = { lat: 48.8566, lon: 2.3522 };

describe("distance and bearing", () => {
  it("haversine matches known city distances", () => {
    expect(haversineMeters(LONDON, PARIS) / 1000).toBeCloseTo(343.5, 0);
    expect(haversineMeters(SEATTLE, PORTLAND) / 1000).toBeCloseTo(233.6, 0);
    expect(haversineMeters(SEATTLE, SEATTLE)).toBe(0);
  });

  it("bearing and its compass point", () => {
    expect(bearingDegrees(LONDON, PARIS)).toBeCloseTo(148.1, 0);
    expect(cardinal(bearingDegrees(LONDON, PARIS))).toBe("SE");
    expect(cardinal(bearingDegrees(SEATTLE, PORTLAND))).toBe("S");
    expect(bearingDegrees({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 5);
    expect(bearingDegrees({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 5);
    expect([0, 22, 23, 90, 180, 270, 337, 338, 359].map(cardinal)).toEqual([
      "N",
      "N",
      "NE",
      "E",
      "S",
      "W",
      "NW",
      "N",
      "N",
    ]);
  });

  it("formats meters and kilometers", () => {
    expect(formatDistance(850.4)).toBe("850 m");
    expect(formatDistance(4230)).toBe("4.2 km");
    expect(formatDistance(37_400)).toBe("37 km");
  });
});

describe("tiles", () => {
  it("slippy coordinates", () => {
    expect(tileCoords({ lat: 0, lon: 0 }, 1)).toEqual({ x: 1, y: 1 });
    const corner = tileCoords({ lat: 85.05112878, lon: -180 }, 3);
    expect(corner.x).toBe(0);
    expect(corner.y).toBeCloseTo(0, 6);
    // Seattle (47.6062, -122.3321) at z14: x 2624.53, y 5721.998.
    const s = tileCoords(SEATTLE, 14);
    expect([Math.floor(s.x), Math.floor(s.y)]).toEqual([2624, 5721]);
  });

  it("ground resolution", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156_543.03, 1);
    expect(metersPerPixel(60, 1)).toBeCloseTo(156_543.03 / 4, 1);
  });

  it("precision radius table and zoom", () => {
    expect(precisionRadiusMeters(10)).toBe(23_300);
    expect(precisionRadiusMeters(13)).toBeCloseTo(2912.5, 1);
    expect(precisionRadiusMeters(16)).toBeCloseTo(364.06, 1);
    expect(precisionRadiusMeters(32)).toBeNull();
    expect(precisionRadiusMeters(null)).toBeNull();
    expect(precisionRadiusMeters(0)).toBeNull();
    expect([null, 32, 16, 15, 13].map(miniMapZoom)).toEqual([14, 14, 14, 11, 11]);
  });

  it("the mosaic keeps the node in the middle column, away from the top and bottom", () => {
    const m = mosaicFor(SEATTLE, null);
    expect(m.z).toBe(14);
    expect(m.tiles).toHaveLength(6);
    expect(m.tiles.map((t) => t.x)).toEqual([2623, 2624, 2625, 2623, 2624, 2625]);
    expect(m.pointX).toBeGreaterThanOrEqual(1 / 3);
    expect(m.pointX).toBeLessThan(2 / 3);
    expect(m.pointY).toBeGreaterThanOrEqual(0.25);
    expect(m.pointY).toBeLessThanOrEqual(0.75);
    // The point is where the node is in the mosaic.
    const { x, y } = tileCoords(SEATTLE, 14);
    expect(m.pointX * 3 + 2623).toBeCloseTo(x, 9);
    expect(m.pointY * 2 + (m.tiles[0]?.y ?? 0)).toBeCloseTo(y, 9);
    expect(m.precisionDiameter).toBeNull();
  });

  it("wraps tiles around the antimeridian", () => {
    const m = mosaicFor({ lat: 0.5, lon: -179.999 }, null);
    expect(m.tiles.slice(0, 3).map((t) => t.x)).toEqual([16383, 0, 1]);
  });

  it("sizes the precision circle against the mosaic", () => {
    const m = mosaicFor(SEATTLE, 13);
    expect(m.z).toBe(11);
    const px = (2 * 2912.5) / metersPerPixel(SEATTLE.lat, 11);
    expect(m.precisionDiameter).toBeCloseTo(px / 768, 6);
  });

  it("tile URLs go through the server's proxy", () => {
    expect(tileUrl(14, 2624, 5721)).toBe("/api/tiles/14/2624/5721.png");
  });
});
