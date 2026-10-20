# MeshTerm — Dashboard Feature Spec

> The original spec (2026-10-19), built as phases D1–D7 (`dashboard-plan.md`). The dashboard was later redesigned by the UI/UX overhaul (`overhaul-plan.md`): KPI cards replace the status strip, the dashboard shows node previews, and the full card grid lives on the Nodes page.

Adds a **Dashboard** tab as the default landing view: a status strip for the mesh as a whole, then a grid of cards, one per node, each with last seen, power, node type, signal and a small map.

Builds on the existing node list data. Follows all rules in `app-design-document.md` §8: tokens only, `data-mt` hooks everywhere, no literal colors.

---

## 1. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Mesh status strip                                            │
│ [● Connected 2h14m] [Nodes 14/37 online] [My batt 87%]       │
│ [Ch util 12%] [Msgs 24h: 58] [Last packet 4s ago]            │
├──────────────────────────────────────────────────────────────┤
│ Toolbar: [Search] [Filter: All|Online|Favorites|Has position]│
│          [Sort: Last seen ▾] [Density: Comfy|Compact]        │
├──────────────────────────────────────────────────────────────┤
│ ★ Favorites (pinned first)                                   │
│ ┌────────┐ ┌────────┐ ┌────────┐                             │
│ │ card   │ │ card   │ │ card   │                             │
│ └────────┘ └────────┘ └────────┘                             │
│ All nodes                                                    │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                  │
└──────────────────────────────────────────────────────────────┘
```

- Grid: CSS grid, `repeat(auto-fill, minmax(280px, 1fr))`, gap from `--mt-space-*` tokens. One column below 600 px.
- **Compact density** hides the mini map and sparkline (for 100+ node meshes and wall displays).
- My own node is always the first card, visually distinct (`data-mt-variant="self"`).
- Route: `/dashboard`; it becomes the default route. Filter, sort and density persist per browser in localStorage (wrapped in try/catch).

## 2. Mesh status strip

| Tile                | Source                                                                | Notes                                                           |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Connection          | connection state + `connected_since`                                  | Same states as the status pill; click opens connection settings |
| Nodes online        | count with `last_heard` within the online threshold / total in NodeDB | Click sets filter to Online                                     |
| My node power       | my node's latest device metrics                                       | Battery % or "External power"                                   |
| Channel utilization | my node's `channel_utilization`                                       | Warn above 25 %, danger above 50 % (configurable)               |
| Air util TX         | my node's `air_util_tx`                                               | Warn above 7 %, danger above 10 % (configurable)                |
| Messages (24 h)     | count from `messages` table                                           | Click goes to Messages                                          |
| Last packet         | `max(rx_time)` in `packet_log`                                        | Ticks live                                                      |

## 3. Node card anatomy

```
┌──────────────────────────────────────┐
│ ● K7AB  Kevin's Base         ★  ⋯    │  status dot, short name, long name, favorite, menu
│ ROUTER · HELTEC_V3 · !a1b2c3d4       │  role badge, hardware model, node ID
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │        mini map (160 px)         │ │  static tile + marker, precision ring
│ └──────────────────────────────────┘ │
│ 4.2 km NE · 312 m alt                │  distance + bearing from my node
├──────────────────────────────────────┤
│ Last seen   3 min ago                │
│ Power       ▮▮▮▯ 78% · 3.98 V   ╱╲╱─ │  battery bar + 24 h sparkline
│ Signal      SNR 6.5 dB · RSSI -92    │
│ Hops        1 (via relay)            │
│ Ch util     9.1 %   Uptime 3d 4h     │
│ Env         22.4 °C · 61 % · 1013 hPa│  only when environment telemetry exists
├──────────────────────────────────────┤
│ [Message] [Traceroute] [Details]     │
└──────────────────────────────────────┘
```

### Fields and rules

| Field              | Source                                             | Display rule                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status dot         | `last_heard`                                       | **Online** < 15 min, **Recent** < 2 h, **Stale** < 24 h, **Offline** ≥ 24 h. Thresholds configurable in Settings. Colors from `--mt-signal-*` tokens.                                                                                                                    |
| Names              | `long_name`, `short_name`                          | Long name truncates with ellipsis; full name in `title`                                                                                                                                                                                                                  |
| Role               | `role` enum                                        | Badge: CLIENT, CLIENT_MUTE, CLIENT_HIDDEN, CLIENT_BASE, ROUTER, ROUTER_LATE, REPEATER, TRACKER, SENSOR, TAK, TAK_TRACKER, LOST_AND_FOUND. Map enum → label in one table; unknown values show the raw enum name. `data-mt-variant="<role>"` so themes can style per role. |
| Hardware           | `hw_model` enum                                    | Human label from a lookup table (e.g. `HELTEC_V3` → "Heltec V3"); fall back to the enum name                                                                                                                                                                             |
| Node ID            | `user_id`                                          | `!a1b2c3d4` format, monospace, click to copy                                                                                                                                                                                                                             |
| Last seen          | `last_heard`                                       | Relative ("3 min ago"), absolute local time on hover. Re-render every 30 s from a single shared timer, not one per card.                                                                                                                                                 |
| Power              | latest device telemetry `battery_level`, `voltage` | `battery_level` > 100 means external power: show a plug icon and "Powered" instead of a %. Missing → "—".                                                                                                                                                                |
| Battery sparkline  | `telemetry` (device) last 24 h                     | Inline SVG polyline, ~80×20 px, stroke `--mt-chart-1`. Hidden if < 2 points.                                                                                                                                                                                             |
| Mini map           | latest position                                    | See §4. No position → themed placeholder "No position shared".                                                                                                                                                                                                           |
| Distance / bearing | haversine from my node's position                  | Units from settings (km/mi). Hidden if either position is missing. Cardinal bearing (N, NE …).                                                                                                                                                                           |
| Altitude           | `altitude`                                         | Units from settings                                                                                                                                                                                                                                                      |
| Signal             | last packet `rx_snr`, `rx_rssi`                    | Only for nodes heard directly (hops = 0); otherwise show "via N hops"                                                                                                                                                                                                    |
| Hops               | `hops_away`                                        | 0 → "Direct"                                                                                                                                                                                                                                                             |
| Ch util / Air TX   | device telemetry                                   | Omitted if not reported                                                                                                                                                                                                                                                  |
| Uptime             | device telemetry `uptime_seconds`                  | "3d 4h"                                                                                                                                                                                                                                                                  |
| Environment        | environment telemetry                              | Row only renders when data exists; units from settings                                                                                                                                                                                                                   |
| Actions            | —                                                  | Message → DM view; Traceroute → triggers and opens result; Details → existing node detail drawer. Menu: favorite, ignore, request position, remove from NodeDB (confirm).                                                                                                |

Viewer-role users see no Message/Traceroute buttons or destructive menu items.

## 4. Mini maps

MapLibre per card is too heavy (one WebGL context each; browsers cap around 16). Use **static raster tiles**:

1. Compute the slippy-map tile `(z, x, y)` for the node position at zoom 14 (zoom 11 if `precision_bits` indicates coarse position).
2. Render a 3×2 tile mosaic in an `overflow: hidden` box, offset so the node sits centered. Plain `<img>` tags with `loading="lazy"`.
3. Marker is an absolutely positioned SVG pin using `--mt-map-marker` (`--mt-map-marker-self` on my card). If precision is reduced, draw a translucent circle sized to the precision radius.
4. Themes can restyle the tiles with CSS `filter` on `[data-mt="mini-map-tiles"]` (e.g. Retro: `grayscale(1) sepia(1) hue-rotate(70deg)`; Cyberpunk: `invert(1) hue-rotate(180deg) saturate(2)`).
5. Clicking the mini map opens the main Map view centered on that node.

### Tile proxy (server)

- `GET /api/tiles/:z/:x/:y.png` fetches from the configured tile URL and caches to `/data/tiles/` (LRU, default 500 MB cap, 30-day TTL).
- Keeps the CSP at `img-src 'self'`, makes tiles work offline once cached, and respects OpenStreetMap's tile policy by not having every browser hit OSM directly. Set a proper `User-Agent` and honour `Cache-Control`.
- The main MapLibre map should switch to this proxy too.

## 5. Data and API

Do not build cards from N separate requests.

`GET /api/connections/:id/dashboard` returns:

```ts
interface DashboardDTO {
  summary: {
    connectionState: ConnState;
    connectedSince: string | null;
    nodesTotal: number;
    nodesOnline: number;
    myNodeNum: number;
    myBattery: number | null;
    channelUtil: number | null;
    airUtilTx: number | null;
    messages24h: number;
    lastPacketAt: string | null;
  };
  thresholds: { onlineMin: number; recentMin: number; staleMin: number };
  nodes: NodeCardDTO[];
}

interface NodeCardDTO {
  num: number;
  userId: string;
  longName: string;
  shortName: string;
  role: string;
  hwModel: string;
  isFavorite: boolean;
  isSelf: boolean;
  lastHeard: string | null;
  hopsAway: number | null;
  snr: number | null;
  rssi: number | null;
  position: {
    lat: number;
    lon: number;
    alt: number | null;
    precisionBits: number | null;
    time: string;
  } | null;
  device: {
    batteryLevel: number | null;
    voltage: number | null;
    channelUtil: number | null;
    airUtilTx: number | null;
    uptimeSeconds: number | null;
  } | null;
  environment: {
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
  } | null;
  batterySpark: Array<[number, number]>; // [epochSec, batteryLevel], ≤ 48 points (downsampled to 30-min buckets)
}
```

- Server builds this with a handful of set-based SQL queries (latest telemetry per node via window function or a `latest_*` cache columns on `nodes`), not per-node loops. Target < 50 ms for 300 nodes.
- Live updates reuse existing WS events (`node.upsert`, `telemetry.new`, `position.new`); the client patches the TanStack Query cache for the dashboard key. Spark data is appended client-side, then refreshed from the server every 10 min.
- Ignored nodes are excluded unless the filter "Show ignored" is on.

## 6. Interaction details

- **Update flash:** when a card receives new data, set `data-mt-state="updated"` for 1.5 s. Themes decide what that looks like (glow, blink, nothing). Respect `prefers-reduced-motion`.
- **Sorting:** last seen (default), name, distance, battery, hops, SNR. Favorites always pinned above, self always first.
- **Search:** matches long name, short name, node ID, hw model.
- **Large meshes:** above 150 cards, render with TanStack Virtual (row-virtualized grid) and default to Compact density.
- **Empty state:** no nodes yet → themed panel explaining the node DB populates after the config handshake.
- **Keyboard:** cards are focusable; Enter opens Details; `f` toggles favorite on the focused card.

## 7. Theming hooks (add to `THEMING.md`)

| Hook                                                                                  | States / variants                                     |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `data-mt="dashboard"`                                                                 |                                                       |
| `data-mt="status-strip"`, `data-mt="status-tile"`                                     | `data-mt-state="ok                                    | warn   | danger"` |
| `data-mt="node-card"`                                                                 | variant: `self`, `favorite`, `<role>`; state: `online | recent | stale    | offline`, `updated` |
| `data-mt="node-card-header"`, `"node-card-body"`, `"node-card-actions"`               |                                                       |
| `data-mt="status-dot"`                                                                | state as above                                        |
| `data-mt="role-badge"`                                                                | variant: `<role>`                                     |
| `data-mt="battery-meter"`                                                             | state: `ok                                            | low    | critical | powered`            |
| `data-mt="sparkline"`                                                                 |                                                       |
| `data-mt="mini-map"`, `"mini-map-tiles"`, `"mini-map-marker"`, `"mini-map-precision"` |                                                       |
| `data-mt="metric-row"`                                                                | variant: field name                                   |

New tokens: `--mt-card-bg`, `--mt-card-border`, `--mt-card-radius`, `--mt-card-shadow`, `--mt-card-self-accent`, `--mt-battery-low` (default `--mt-warning`), `--mt-battery-critical` (default `--mt-danger`). Low battery < 20 %, critical < 10 %.

Each built-in theme must style the dashboard; add it to the Playwright screenshot matrix.

## 8. Settings additions

- Online / recent / stale thresholds (minutes)
- Default density, default sort
- Mini map tile URL (shared with main map) and cache size
- Channel util / air util warn and danger levels

## 9. Acceptance criteria

- [ ] Dashboard is the default route and loads with one API call
- [ ] My node is first; favorites pinned; sort and filters work and persist
- [ ] Every card shows last seen, power (with "Powered" for > 100), role, hardware, and a mini map or the no-position placeholder
- [ ] Cards update live over WS without refetching, with the `updated` state flash
- [ ] Mini maps load lazily from the server tile proxy; tiles served from cache on second load; CSP still `img-src 'self'`
- [ ] 300 FakeNode nodes render smoothly (compact + virtualization) and the API responds in < 50 ms
- [ ] Viewer role sees no send/traceroute/destructive actions
- [ ] Usable at 390 px; Playwright screenshots in all built-in themes
- [ ] FakeNode fixtures cover: powered node, no-position node, reduced-precision node, environment-sensor node, multi-hop node, stale node
