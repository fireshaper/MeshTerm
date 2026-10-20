# MeshTerm — Map View Feature Spec

A full-screen, themeable map of the mesh. It shows where every node is, how they connect, where they've been, and how traceroutes travel. It is built on MapLibre GL JS and uses the server tile proxy from `dashboard-spec.md` §4.

It follows all rules in `app-design-document.md` §8: tokens only, `data-mt` hooks on every HTML element, no literal colors (including in map paint properties; see §6).

---

## 0. Scope and build order

**The Map is its own page.** It is a top-level "Map" item in the main navigation (sidebar on desktop, bottom tab bar on mobile), next to Dashboard and Messages, at route `/map`. It is **not** embedded in the dashboard. The dashboard's small per-card maps stay as they are; clicking one opens this page centered on that node.

### Phase A — build this first (the core page)

A full-page map you can pan (drag/scroll) and zoom freely, with a marker at the last known location of **every node you've ever seen** that has reported a position.

- Base map: OpenStreetMap tiles via the server proxy (§4).
- Data: one marker per node in the NodeDB/`nodes` table with a stored position. Include old and offline nodes; default time range is **All** (not 24 h).
- Marker: dot plus short-name label, colored by last-heard status. Your own node is visually distinct.
- Click a marker: popup with long name, short name, node ID, last seen, battery, hops, and a "Details" link to the node drawer.
- Opens fitted to all markers; the last viewport is remembered on return visits.
- Mouse wheel / trackpad / pinch zoom, drag to pan, zoom +/− buttons, "Fit all" and "My node" buttons.
- New and moved positions update live.
- Clustering when markers overlap at low zoom.
- Nodes with no position are listed in a small "Not on map (N)" count; clicking it shows their names.

Phase A acceptance: open `/map` from the nav and see every node with a known position on an OpenStreetMap base; pan and zoom anywhere; click any marker for its info.

### Phase B — after Phase A ships

Everything else in this spec, in this order: node side panel + search (§1), time range filter, neighbor links, traceroute paths, position trails, measure tool, range rings, then offline vector maps and coverage heat.

---

## 1. Layout

```
┌───────────────────────────────────────────────────────────────┐
│ [Search node…]          [Layers ▾] [Time: 24h ▾]  [⤢] [◎] [📏] │ ← map toolbar
├──────────────┬────────────────────────────────────────────────┤
│ Node panel   │                                                │
│ (collapsible)│                  MAP                           │
│ ● K7AB 3m    │        ● ─── ●                                 │
│ ● RLY1 12m   │         ╲   ╱      ( 12 )  ← cluster           │
│ ○ BASE 4h    │          ●                                     │
│ …            │                                                │
│              │  [scale]                     [attribution]     │
├──────────────┴────────────────────────────────────────────────┤
│ Selected: K7AB · 4.2 km NE · seen 3m · 78% · SNR 6.5 [Details] │ ← selection bar
└───────────────────────────────────────────────────────────────┘
```

- **Desktop (≥ 768 px):** collapsible left node panel (300 px), map fills the rest.
- **Mobile (< 768 px):** map full-bleed; the node panel becomes a draggable bottom sheet (peek / half / full); the toolbar collapses into a single menu button.
- Route `/map`. Deep links: `/map?node=!a1b2c3d4`, `/map?lat=…&lon=…&z=…`, `/map?traceroute=<id>`. The dashboard mini map and node detail drawer link here with `?node=`.
- Viewport (center/zoom), layer toggles and time range persist per browser in localStorage (try/catch).

## 2. Layers

Each layer has a toggle in the Layers menu. Default-on layers are marked ✓.

| Layer               | Default                | Source                                                                          | Rendering                                                                                                                                                                                                                          |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nodes**           | ✓                      | latest position per node                                                        | Circle + short-name label (symbol layer). Fill color by status (online/recent/stale/offline, same thresholds as dashboard). Self node larger with a ring. Favorites get a star badge.                                              |
| **Clusters**        | ✓                      | same GeoJSON source, `cluster: true`, `clusterRadius: 50`, `clusterMaxZoom: 13` | Circle sized by count; click zooms to expand. Cluster color reflects the "best" status inside it.                                                                                                                                  |
| **Precision areas** | ✓                      | positions with reduced `precision_bits`                                         | Translucent circle at the precision radius, drawn under the node dot. Below zoom 10 hidden.                                                                                                                                        |
| **Neighbor links**  | ✓                      | NeighborInfo module packets                                                     | Lines between nodes that hear each other directly, colored by SNR band (good / fair / poor), width by recency. Dashed if older than the stale threshold.                                                                           |
| **Traceroutes**     | ✓ when one is selected | `traceroutes` table                                                             | Polyline through each hop, arrowheads showing direction; outbound and return paths offset slightly so both are visible. Per-hop SNR labels at segment midpoints. Hops with no known position are drawn as a gap with a "?" marker. |
| **Position trails** | off                    | `positions` history within time range                                           | Line per node (selected node only by default; "all nodes" option), fading from old to new. Dots at each fix with timestamp on hover.                                                                                               |
| **Range rings**     | off                    | my node position                                                                | Rings at 1 / 5 / 10 / 25 km (or mi), labeled.                                                                                                                                                                                      |
| **Coverage heat**   | off (v1.1)             | positions + rx SNR of directly heard packets                                    | MapLibre heatmap layer weighted by SNR. Marked experimental.                                                                                                                                                                       |

### Time range filter

Options: Online only · 1 h · 24 h · 7 d · All (default; the map shows every node ever seen). It applies to the Nodes layer (by `last_heard`), the Neighbor links layer (by link `rx_time`) and the Position trails layer.

## 3. Interaction

| Action                        | Result                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Click node                    | Select it: highlight, show selection bar, highlight its neighbor links, scroll the node panel to it                          |
| Click selection bar "Details" | Opens the existing node detail drawer                                                                                        |
| Right-click / long-press node | Context menu: Message, Traceroute, Request position, Show trail, Favorite, Center                                            |
| Click cluster                 | Zoom to its expansion zoom                                                                                                   |
| Click empty map               | Clear selection                                                                                                              |
| Click a link                  | Popover: both node names, SNR, last updated                                                                                  |
| Node panel row click          | Fly to the node and select it                                                                                                |
| Search                        | Matches name/short name/ID; Enter flies to the first match                                                                   |
| ⤢ Fit                         | Fit bounds to all visible nodes (padding 48 px)                                                                              |
| ◎ Locate                      | Fly to my node                                                                                                               |
| 📏 Measure                    | Click two points (or two nodes) to show distance and bearing; Esc exits                                                      |
| Run traceroute                | Triggered from the context menu; on result, the map draws it and fits to the route. Toast while pending, timeout after 60 s. |

Viewer role: no Message/Traceroute/Request position actions.

Keyboard: `/` focuses search, `f` fit, `l` locate my node, `Esc` clears selection or exits measure mode.

## 4. Base map

**v1: OpenStreetMap raster tiles via the server proxy** (`/api/tiles/:z/:x/:y.png`, shared with the dashboard mini maps).

**Default base map: OpenStreetMap standard tiles**

| Setting           | Default                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| Tile URL template | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`                                   |
| Attribution       | `© OpenStreetMap contributors` linked to `https://www.openstreetmap.org/copyright` |
| Max zoom          | 19                                                                                 |
| Tile size         | 256                                                                                |

The server proxy must follow the [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/), since all MeshTerm traffic to OSM goes through it:

- Send a valid, identifying `User-Agent` (e.g. `MeshTerm/<version> (+<repo URL>)`), and a `Referer` when one applies.
- Cache tiles on disk and honour the `Cache-Control`/`Expires` headers OSM returns. Serve from the cache first, and re-fetch only when a tile is stale.
- Never bulk-download or prefetch tiles from OSM (see "Tile prefetch" below).
- Limit concurrency to OSM to 2 simultaneous requests and queue the rest.
- Always render the attribution, and never hide it via a theme (the attribution element keeps `display` and `visibility` forced on in base CSS).

- Tile URL template and attribution remain configurable in Settings, so you can switch to another OSM-based provider or a self-hosted tile server. Changing the URL clears the tile cache.
- MapLibre style is built in code: one raster source pointing at the proxy plus our own layers.
- Theme override: if the active theme ships `map-style.json`, it replaces the base raster layer section (e.g. a different tile URL like a dark basemap, or `raster-saturation`, `raster-hue-rotate`, `raster-contrast`, `raster-brightness-min/max` paint values). Do **not** use a CSS `filter` on the canvas: it would also recolor markers and links.

**v1.1: offline vector maps (optional).**

- Support a `.pmtiles` file dropped into `/data/maps/` (e.g. a regional Protomaps extract), served by the server with HTTP range requests and read via the `pmtiles` MapLibre protocol.
- Vector styles let each theme recolor roads, water and labels fully (true neon roads for Cyberpunk, monochrome vectors for Retro).
- Settings: choose "Online raster" vs "Offline vector (file)".

**Tile prefetch:** admin-only "Cache this area" (zoom range + current bounds, hard cap 5 000 tiles). Disabled when the tile URL points at `tile.openstreetmap.org`, because OSM's tile policy forbids bulk downloading; allowed for self-hosted or permissive providers.

## 5. Data and API

| Endpoint                                              | Returns                                                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/connections/:id/map/nodes?since=`           | GeoJSON `FeatureCollection<Point>`; properties: `num, userId, shortName, longName, role, status, lastHeard, isSelf, isFavorite, precisionMeters, batteryLevel, hopsAway, snr` |
| `GET /api/connections/:id/map/links?since=`           | GeoJSON `FeatureCollection<LineString>`; properties: `a, b, snr, band, rxTime` (deduped: one feature per node pair, newest SNR)                                               |
| `GET /api/connections/:id/nodes/:num/track?from=&to=` | GeoJSON `LineString` + points with timestamps; server downsamples to ≤ 500 points                                                                                             |
| `GET /api/connections/:id/traceroutes/:tid`           | Existing DTO + resolved positions per hop (null if unknown)                                                                                                                   |
| `POST /api/connections/:id/tiles/prefetch`            | Admin; body `{ bbox, minZoom, maxZoom }`; returns job id; progress over WS `tiles.prefetch`                                                                                   |

### New table

```
neighbors(connection_id, node_num, neighbor_num, snr, rx_time,
          PRIMARY KEY (connection_id, node_num, neighbor_num))
```

Upsert on every `NEIGHBORINFO_APP` packet. Links are undirected for display, keyed `(min(a,b), max(a,b))`. Prune with the same retention as telemetry.

### Live updates

- Reuse the existing WS events `node.upsert`, `position.new` and `traceroute.result`, and add `neighbors.update`.
- Client keeps the GeoJSON in memory and calls `source.setData()`, **throttled to at most once per second** per source.
- Animate a marker's move only if the new position is < 2 km away and the tab is visible; otherwise snap.

### Performance targets

- 500 nodes + 1 000 links render at 60 fps on a mid-range laptop and stay responsive on a phone.
- Initial map load issues ≤ 3 API calls.
- MapLibre is code-split: the map bundle loads only when `/map` is opened.

## 6. Theming

MapLibre paints on a canvas, so CSS can't style the dots and lines directly. Bridge tokens into the map:

1. A `useMapTokens()` hook reads the CSS custom properties below from `getComputedStyle(document.documentElement)`.
2. Feed them into layer `paint` properties (`circle-color`, `line-color`, `text-color`, `text-halo-color`, fonts).
3. Re-apply with `map.setPaintProperty()` whenever the theme changes (listen for the existing `theme.changed` event / `data-mt-theme` mutation). No map reload.
4. Text labels use `--mt-font-map` mapped to a glyph set; ship default glyphs locally (no external font CDN) and let themes provide their own glyph PBFs in `themes/<id>/glyphs/`.

**Tokens** (defaults reference existing tokens):

| Token                                                      | Default                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `--mt-map-node-online` / `-recent` / `-stale` / `-offline` | `--mt-signal-excellent` … `--mt-signal-none`             |
| `--mt-map-marker-self`                                     | (exists)                                                 |
| `--mt-map-label`, `--mt-map-label-halo`                    | `--mt-text`, `--mt-bg`                                   |
| `--mt-map-cluster-bg`, `--mt-map-cluster-text`             | `--mt-accent`, `--mt-accent-contrast`                    |
| `--mt-map-link-good` / `-fair` / `-poor`                   | `--mt-success` / `--mt-warning` / `--mt-danger`          |
| `--mt-map-route`                                           | (exists)                                                 |
| `--mt-map-trail`                                           | `--mt-chart-2`                                           |
| `--mt-map-precision`                                       | `--mt-accent` at 15 % alpha (themes set via `color-mix`) |
| `--mt-map-range-ring`                                      | `--mt-border-strong`                                     |
| `--mt-font-map`                                            | `--mt-font-ui`                                           |

**HTML hooks** (toolbar, panels, popovers are normal DOM):

`data-mt="map-view"`, `"map-toolbar"`, `"map-layers-menu"`, `"map-node-panel"`, `"map-node-row"` (state: online/recent/stale/offline; variant: self/favorite), `"map-selection-bar"`, `"map-popover"`, `"map-context-menu"`, `"map-measure"`, `"map-attribution"`.

MapLibre's built-in controls (zoom, scale, attribution) are restyled through those hooks; never override `.maplibregl-*` classes directly from app code. Themes may.

Built-in theme expectations:

- **Cyberpunk:** dark raster style, neon node dots with glow (`circle-blur`), magenta routes, cyan links.
- **Retro Terminal:** high-contrast monochrome tiles (`raster-saturation: -1`, tinted via `raster-hue-rotate`), square-ish dots, monospace labels, no blur.

## 7. Settings additions

- Tile URL template, attribution text, max zoom (defaults: OpenStreetMap, see §4)
- Map source: Online raster / Offline vector (PMTiles file picker from `/data/maps`)
- Default layers and time range
- Units (shared) and range ring distances
- Link SNR bands (default good ≥ 5 dB, fair ≥ −5 dB, poor below)

## 8. Acceptance criteria

- [ ] Map is a standalone page reachable from the main navigation, not part of the dashboard
- [ ] `/map` shows every node ever seen that has a position (including offline/old nodes), clustered at low zoom, colored by status
- [ ] Free pan and zoom; clicking a marker shows its info popup
- [ ] Clicking a node selects it, shows the selection bar and highlights its neighbor links
- [ ] Deep links (`?node=`, `?traceroute=`) work, including from the dashboard mini map
- [ ] Neighbor links appear from NeighborInfo packets and color by SNR band
- [ ] Running a traceroute from the map draws out and back paths with per-hop SNR; unknown-position hops shown as gaps
- [ ] Position trail for a node over 24 h / 7 d renders, downsampled server-side
- [ ] Live position updates move markers without a full reload; `setData` throttled to 1/s
- [ ] Switching theme recolors markers, links, labels and controls instantly with no map reload
- [ ] Base map is OpenStreetMap out of the box with no configuration
- [ ] All tiles load via `/api/tiles`; CSP unchanged; OSM attribution always visible in every theme
- [ ] Proxy sends an identifying User-Agent, caches per OSM headers, and caps concurrent upstream requests at 2
- [ ] Prefetch is blocked for `tile.openstreetmap.org`
- [ ] 500 FakeNode nodes + 1 000 links stay smooth; map bundle is lazy-loaded
- [ ] Mobile bottom sheet works at 390 px
- [ ] Playwright screenshots of `/map` in all built-in themes
- [ ] FakeNode fixtures include NeighborInfo packets, a multi-hop traceroute with an unknown-position hop, a moving node, and a reduced-precision node
