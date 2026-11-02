// The base map under the Overview and the Map page: topographic (OpenTopoMap, the
// default) or the street map, remembered in this browser. Both come through the
// server's tile caches; the credit line follows the one shown.
import { create } from "zustand";

export type BaseMap = "topo" | "street";

export const BASE_MAP_KEY = "meshterm.baseMap";
export const DEFAULT_BASE_MAP: BaseMap = "topo";

export const BASE_MAPS: Readonly<
  Record<BaseMap, { label: string; path: string; maxZoom: number }>
> = {
  topo: { label: "Topographic", path: "/api/tiles/topo", maxZoom: 17 },
  street: { label: "Street", path: "/api/tiles", maxZoom: 19 },
};

/** The base map this browser last chose, if storage allows. */
export function readBaseMap(): BaseMap {
  try {
    const saved = localStorage.getItem(BASE_MAP_KEY);
    if (saved === "topo" || saved === "street") return saved;
  } catch {
    // Unreadable or blocked: the default.
  }
  return DEFAULT_BASE_MAP;
}

interface BaseMapState {
  base: BaseMap;
  setBase: (base: BaseMap) => void;
}

export const useBaseMap = create<BaseMapState>()((set) => ({
  base: readBaseMap(),
  setBase: (base) => {
    try {
      localStorage.setItem(BASE_MAP_KEY, base);
    } catch {
      // Storage blocked: only this page remembers.
    }
    set({ base });
  },
}));

/** One tile through the server's cache for the given base map. */
export const baseTileUrl = (base: BaseMap, z: number, x: number, y: number): string =>
  `${BASE_MAPS[base].path}/${z}/${x}/${y}.png`;

const LINK = { target: "_blank", rel: "noreferrer" } as const;

/** The credit the tiles' licenses ask for. */
export function MapCredit({ base, variant }: { base: BaseMap; variant?: "overview" }) {
  return (
    <div data-mt="map-attribution" data-mt-variant={variant}>
      ©{" "}
      <a data-mt="map-attribution-link" href="https://www.openstreetmap.org/copyright" {...LINK}>
        OpenStreetMap
      </a>{" "}
      contributors
      {base === "topo" && (
        <>
          , SRTM · ©{" "}
          <a data-mt="map-attribution-link" href="https://opentopomap.org/about" {...LINK}>
            OpenTopoMap
          </a>{" "}
          (CC-BY-SA)
        </>
      )}
    </div>
  );
}
