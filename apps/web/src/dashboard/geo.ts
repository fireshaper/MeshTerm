/** Geometry for cards: distances, bearings and slippy-map tiles (Web Mercator, 256 px tiles). */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north in [0, 360). */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The nearest of the eight compass points. */
export function cardinal(bearing: number): (typeof CARDINALS)[number] {
  return CARDINALS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8] ?? "N";
}

/** "850 m", "4.2 km", "37 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export const TILE_SIZE = 256;

/** Position in tile units at zoom `z`: the integer part is the tile, the rest is where in it. */
export function tileCoords({ lat, lon }: LatLon, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = ((lon + 180) / 360) * n;
  const latRad = rad(clampedLat);
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Ground meters per pixel at a latitude and zoom. */
export function metersPerPixel(lat: number, z: number): number {
  return (2 * Math.PI * 6_378_137 * Math.cos(rad(lat))) / (TILE_SIZE * 2 ** z);
}

/**
 * Radius in meters of the area a position coarsened to `precisionBits` may lie in
 * (Meshtastic: 10 bits ≈ 23.3 km, halving per extra bit). Null when the position is exact.
 */
export function precisionRadiusMeters(precisionBits: number | null): number | null {
  if (precisionBits === null || precisionBits <= 0 || precisionBits >= 32) return null;
  return 23_300 * 2 ** (10 - precisionBits);
}

/** Zoom 14 normally; 11 when the precision area wouldn't fit at 14 (≥ ~730 m radius). */
export function miniMapZoom(precisionBits: number | null): number {
  const radius = precisionRadiusMeters(precisionBits);
  return radius !== null && radius > 500 ? 11 : 14;
}

export interface Mosaic {
  z: number;
  /** 3 columns × 2 rows, row by row; `x` already wrapped around the antimeridian. */
  tiles: { x: number; y: number }[];
  /** The node's place in the mosaic, as a fraction of its width and height. */
  pointX: number;
  pointY: number;
  /** Precision circle diameter as a fraction of the mosaic width; null when exact. */
  precisionDiameter: number | null;
}

export const MOSAIC_COLS = 3;
export const MOSAIC_ROWS = 2;

/**
 * The 3×2 tiles around a position. The node's tile is the middle column; the second
 * row is the one nearer the node, so it is at least half a tile from the top and
 * bottom edges, enough to center it in a box up to 2 tiles wide and 1 tile tall.
 */
export function mosaicFor(position: LatLon, precisionBits: number | null): Mosaic {
  const z = miniMapZoom(precisionBits);
  const n = 2 ** z;
  const { x, y } = tileCoords(position, z);
  const tx = Math.floor(x);
  const ty = Math.min(n - 1, Math.floor(y));
  const top = Math.max(0, Math.min(n - MOSAIC_ROWS, y - ty < 0.5 ? ty - 1 : ty));
  const left = tx - 1;
  const tiles: { x: number; y: number }[] = [];
  for (let row = 0; row < MOSAIC_ROWS; row++) {
    for (let col = 0; col < MOSAIC_COLS; col++) {
      tiles.push({ x: (((left + col) % n) + n) % n, y: top + row });
    }
  }
  const radius = precisionRadiusMeters(precisionBits);
  return {
    z,
    tiles,
    pointX: (x - left) / MOSAIC_COLS,
    pointY: (y - top) / MOSAIC_ROWS,
    precisionDiameter:
      radius === null
        ? null
        : (2 * radius) / metersPerPixel(position.lat, z) / (TILE_SIZE * MOSAIC_COLS),
  };
}

export function tileUrl(z: number, x: number, y: number): string {
  return `/api/tiles/${z}/${x}/${y}.png`;
}
