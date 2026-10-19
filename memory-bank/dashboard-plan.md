# MeshTerm — Dashboard Implementation Plan (v1)

Step-by-step plan for the **Dashboard** feature from the Dashboard Feature Spec (pasted by the user on 2026-10-19; summarized below where it matters). Same rules as `implementation-plan.md`: steps in order, each step done only when its **Test** passes and `typecheck`, `lint`, `format:check` and existing tests stay green; stop after every phase, update `progress.md`, record choices in `DECISIONS.md`, commit only when asked. Theming rules from `CLAUDE.md` apply throughout (tokens only, `data-mt` hooks, no literal colors, no transmits beyond handshake and heartbeat in tests).

## Scope (agreed 2026-10-19)

**Dashboard v1 + the data it needs.** Build everything a card needs to show real data: telemetry and position decoding and storage, `connected_since`, last-packet time, the tile proxy, the dashboard API, cards, mini maps, the status strip, search/filter/sort/density and the favorite toggle.

**Left out until their features exist** (the base plan's "Out of scope" list): Traceroute and Details buttons, the card `⋯` menu items (ignore, request position, remove from NodeDB), the viewer role, the Settings UI (thresholds use defaults stored in `settings`), click-through to a Map view, the Cyberpunk and Retro themes (screenshots in Default only) and `THEMING.md` (hooks go in `architecture.md` for now). Card actions in v1: **Message** (→ DM) and **favorite** (★). The spec's other acceptance items are met for what is built.

## Mapping to existing names

| Spec                          | MeshTerm                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `--mt-warning`, `--mt-danger` | `--mt-status-warn`, `--mt-status-error`                                                     |
| `--mt-signal-*`               | new: `--mt-signal-online`, `--mt-signal-recent`, `--mt-signal-stale`, `--mt-signal-offline` |
| `user_id`                     | `MeshNode.id` (`!hex`, derived from `num`)                                                  |
| `packet_log` `max(rx_time)`   | new `connections.last_packet_at` (no packet log yet)                                        |
| "Messages" view               | channel 0                                                                                   |
| Node detail drawer / Map view | not built; no click-through in v1                                                           |

---

## Phase D1 — Telemetry and position data

### Step D1.1 — Schema

- New tables `positions` (history: connection, node, lat, lon, altitude, precision bits, position time, rx time) and `telemetry` (history: connection, node, kind `device` | `environment`, time, and nullable columns `battery_level`, `voltage`, `channel_util`, `air_util_tx`, `uptime_seconds`, `temperature`, `humidity`, `pressure`). Indexes on `(connection_id, node_num, time)`.
- **Latest values cached on `nodes`** (`lat`, `lon`, `altitude`, `precision_bits`, `position_time`, `battery_level`, `voltage`, `channel_util`, `air_util_tx`, `uptime_seconds`, `device_time`, `temperature`, `humidity`, `pressure`, `env_time`), so the dashboard reads one row per node.
- `connections.last_packet_at`.

**Test:** the migration applies to a fresh DB and to a DB holding Phase 0–11 data (rows survive). `sqlite_master` and `table_info` checks for every new table, column and index.

### Step D1.2 — Decode telemetry and position

- `TELEMETRY_APP` → `radio.telemetry` (device or environment; other variants ignored with a reason). `POSITION_APP` → `radio.position` (`latitude_i`/`longitude_i` × 1e-7; no fix → ignored).
- Handshake `NodeInfo.position` and `NodeInfo.deviceMetrics` produce the same events, so a fresh start has data before any packet arrives.

**Test:** decoder unit tests on frames recorded from FakeNode: device, environment, position, reduced-precision position, position without a fix, NodeInfo carrying both.

### Step D1.3 — Persist and broadcast

- The persistence subscriber writes history rows, updates the `nodes` latest columns (never older over newer), and publishes `telemetry.new` / `position.new` (added to the shared WS schemas). Every packet updates `connections.last_packet_at`.
- `NodeConnection` exposes `stateSince` (when it entered its current state).

**Test:** the pipeline integration test injects telemetry and a position via FakeNode; rows exist, `nodes` latest columns match, and the WS client receives both events. An older telemetry packet doesn't overwrite newer latest values.

### Step D1.4 — FakeNode fixtures

- FakeNode: `injectTelemetry(from, device | environment)`, `injectPosition(from, position)`; control API and CLI gain both.
- New scenario `dashboard` (default scenario unchanged, so existing tests keep their counts) covering: powered node (battery > 100), no-position node, reduced-precision node, environment-sensor node, multi-hop node, stale node (> 24 h), plus favorites.
- Generated scenario `large` with 300 nodes (deterministic, seeded), for performance tests.

**Test:** handshake tests for both scenarios (node counts, fixture properties present on the wire).

## Phase D2 — Dashboard API

### Step D2.1 — `GET /api/connections/:id/dashboard`

- Returns the spec's `DashboardDTO` (summary, thresholds, nodes with position/device/environment/batterySpark) built from a few set-based queries: nodes + latest columns, one grouped spark query (30-min buckets over 24 h, ≤ 48 points per node), message count over 24 h. No per-node queries.
- Thresholds from `settings` with defaults (online 15 min, recent 2 h, stale 24 h; channel util warn 25 / danger 50; air util TX warn 7 / danger 10).
- Ignored nodes: there's no ignore flag yet, so all nodes are returned (the filter comes with the ignore feature).

**Test:** `app.inject` against the `dashboard` scenario checks every DTO field for each fixture node. Spark downsampling has a unit test. Response time < 50 ms for the `large` scenario with 300 nodes × 24 h of telemetry (median of 20 calls).

### Step D2.2 — Favorite toggle

- `PUT /api/connections/:id/nodes/:num/favorite` `{favorite: boolean}` sets the local flag and publishes `node.upsert`. (Local only; syncing favorites to the device is an admin action for later.)

**Test:** toggling updates the DB, emits one `node.upsert`, unknown node → 404, and nothing is transmitted.

## Phase D3 — Tile proxy and CSP

### Step D3.1 — Tile proxy

- `GET /api/tiles/:z/:x/:y.png` fetches from `MESHTERM_TILE_URL` (default OpenStreetMap), with a descriptive `User-Agent`, caches under `<data>/tiles/z/x/y.png`, LRU-evicts to `MESHTERM_TILE_CACHE_MB` (default 500), uses a 30-day TTL (and honours the upstream `Cache-Control` max-age when it is shorter), and validates z/x/y ranges.

**Test:** against a local fake tile server: first request fetches, second is served from cache with no upstream hit, expired tiles refetch, the cache size cap evicts least-recently-used, upstream errors return 502 without caching, and out-of-range coordinates return 400.

### Step D3.2 — Content Security Policy

- `@fastify/helmet` with a CSP that keeps `img-src 'self' data:`, `connect-src 'self'`, and a hash for index.html's inline layer-order `<style>`.

**Test:** responses carry the CSP header. The whole Playwright suite still passes under it, so nothing is blocked.

## Phase D4 — Dashboard page and data

### Step D4.1 — Route, nav and data

- `/dashboard` becomes the default route (`/` redirects there); a "Dashboard" nav item. `useDashboard()` loads the DTO in one call. WS events patch it in place: `node.upsert`, `telemetry.new` (appends a spark point), `position.new`, `connection.state`. Spark data is refreshed from the server every 10 min.
- One shared "now" ticking every 30 s (a context), replacing per-component timers.

**Test:** reducer unit tests on a real `QueryClient` (each event patches the right node, unknown nodes are ignored). A component test checks that the page makes exactly one API call.

### Step D4.2 — Status strip

- Tiles: Connection (state + duration since `stateSince`), Nodes online (count/total; click → Online filter), My power (battery % or "Powered"), Channel util and Air util TX (`ok`/`warn`/`danger` from thresholds), Messages 24 h (click → channel 0), Last packet (ticks live).

**Test:** a component test covers each tile's value and `data-mt-state`, with warn/danger boundaries.

### Step D4.3 — Toolbar: search, filter, sort, density

- Search (long name, short name, `!id`, hardware). Filter All | Online | Favorites | Has position. Sort last seen (default), name, distance, battery, hops, SNR. Density Comfy | Compact. Self first, then favorites pinned in their own section. Filter, sort and density persist in localStorage (try/catch).

**Test:** a component test checks each filter, sort, search and the pinning rules. Persistence works across remounts, and a throwing `localStorage` doesn't break anything.

## Phase D5 — Node card

### Step D5.1 — Card

- Anatomy and display rules from the spec: status dot (online/recent/stale/offline), names (ellipsis + `title`), role badge (label table; unknown → raw), hardware label table (fallback raw), click-to-copy `!id`, last seen (relative + absolute on hover), battery meter (`ok`/`low` < 20 %/`critical` < 10 %/`powered` > 100) + sparkline (inline SVG, hidden below 2 points), signal (direct only; else "via N hops"), hops ("Direct" for 0), channel util/air TX/uptime when reported, environment row only with data. Actions: Message (→ DM, hidden on self) and ★ favorite.
- `data-mt-state="updated"` for 1.5 s when new data arrives (no animation under `prefers-reduced-motion`; themes decide the look). Keyboard: cards are focusable, Enter opens the DM (Details doesn't exist yet), `f` toggles favorite.

**Test:** component tests per fixture node (powered, no position, environment, multi-hop, stale, self) plus the update flash and keyboard.

## Phase D6 — Mini maps

### Step D6.1 — Tile mosaic, marker and precision

- Slippy-tile math (zoom 14; 11 when `precision_bits` is coarse), a 3×2 `<img loading="lazy">` mosaic from `/api/tiles`, offset so the node is centered, an SVG pin (`--mt-map-marker`, `--mt-map-marker-self`) and a precision circle sized from `precision_bits`. Placeholder "No position shared" when there's no position. Distance and cardinal bearing from my node (haversine; km by default, setting `units`), plus altitude. Compact density hides map and sparkline.

**Test:** unit tests for tile math, centering offsets, the precision radius table, haversine and bearing against known values, and the placeholder.

## Phase D7 — Scale, theming and acceptance

### Step D7.1 — Large meshes

- Above 150 cards, a row-virtualized grid (TanStack Virtual) with Compact density by default. Empty state when the node DB is empty.

**Test:** with the `large` scenario (300 nodes), fewer than 100 cards are in the DOM, and scrolling renders more.

### Step D7.2 — Tokens, hooks and docs

- New tokens in base + Default theme: `--mt-card-bg`, `--mt-card-border`, `--mt-card-radius`, `--mt-card-shadow`, `--mt-card-self-accent`, `--mt-battery-low`, `--mt-battery-critical`, `--mt-signal-*`, `--mt-chart-1`, `--mt-map-marker`, `--mt-map-marker-self`. Hook list in `architecture.md`.

**Test:** `lint:css` passes (no literals outside themes). Every new component test uses `expectDataMt`.

### Step D7.3 — End-to-end and visual

- Playwright on the `dashboard` scenario: dashboard is the landing page; my node is first and favorites are pinned; a filter/sort round-trip survives a reload; injected telemetry updates a card live with the `updated` flash and no refetch; mini maps load through the proxy (a fake tile server in the harness) and the second load is served from cache; usable at 390 px with no horizontal page scroll. Visual baselines (Default theme, 1280 + 390 px, win32 + linux).

**Test:** the specs pass, and the full suite, the gate ×3 and the visual baselines pass in CI.
