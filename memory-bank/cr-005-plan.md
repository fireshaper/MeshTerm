# CR-005 Field Kit — build plan

CR: [cr-005-field-kit.md](cr-005-field-kit.md). Mockup: [mockups/field-kit/b-field-kit.html](mockups/field-kit/b-field-kit.html) (example data; open it in a browser). Same rules as the other plans: phases in order, each done when its tests pass and `typecheck`, `lint`, `format:check`, `docs:tokens --check`, `test` and `test:e2e` stay green; stop after every phase, update `progress.md`, then commit and push; record choices in `DECISIONS.md`; theming rules from `CLAUDE.md` (tokens only, `data-mt` hooks in the registry, no literal colors outside `themes/`, Radix unstyled only); never transmit on the mesh in tests.

The CR's open questions (§12) are built with their bold defaults unless the user answers otherwise before the phase that needs them: K1 (question 1), K2 (2), K4 (3), K0 (4).

## Where the code is today (2026-11-01)

- **Shell:** [AppShell.tsx](../apps/web/src/shell/AppShell.tsx) (header, `sidebar` with `meshterm.sidebar`, `nav-drawer` below 768 px), [MainNav.tsx](../apps/web/src/shell/MainNav.tsx), [ConnectionIndicator.tsx](../apps/web/src/shell/ConnectionIndicator.tsx), layout in [shell.css](../apps/web/src/styles/shell.css).
- **Theme runtime:** [public/theme-boot.js](../apps/web/public/theme-boot.js) sets `data-mt-theme` and `data-mt-mode`; `src/theme/theme.ts` saves `meshterm.theme` (`{id, hash, entry, scheme, mode, chosen}`); the manifest Zod schema is in `packages/shared`. No accent concept.
- **Default theme:** `themes/default/theme.json` + `theme.css` only (no fonts, no map style). Cyberpunk shows how a theme ships fonts, `LICENSES.md` and `map-style.json`.
- **Dashboard:** `pages/DashboardPage.tsx` with `NetworkKpis`/`MetricCard`, `TrafficPanel` (`TimeChart`), `ActivityFeed`, `NetworkMap`, `AttentionList`, `NodePreviewCard`, `MiniMap`; styles in `dashboard.css` and `insights.css`.
- **Map:** `map/MapPage.tsx` (MapLibre, clustering, popover, "Not on map" list), `map-tokens.ts`, `map-style.ts`, `map.css`.
- **Messages:** `messages/` + `components/ConversationView`, `MessageList`, `MessageItem`, `Composer`; `messages.css`, `conversation.css`.
- **Nodes:** `pages/NodesPage.tsx`, `NodesToolbar`, `CardGrid`/`NodeCard`, `components/NodeTable`.
- **Drawer:** `node-drawer/` (four tabs, `OverviewTab` with `MiniMap` and recent DMs via `?peer=`, uPlot charts).
- **Settings:** `settings/SettingsPages.tsx`, `settings/device/` (registry, `ReviewDialog`, `ApplyProgress`, `ChannelsEditor`), `AppearanceSettings.tsx`, `NotificationSettings.tsx`; `device-settings.css`, `appearance.css`.
- **Messages API:** filters by `peer` only; no sender filter for channel messages.
- **Geometry:** `dashboard/geo.ts` has distances and `bearingDegrees`.

## Phase K0: accents and the Field Kit palette

- **Manifest:** `accents?: { id, name, preview }[]` in the shared `ThemeManifest` (≤ 6, id `[a-z0-9-]{1,20}`, unique; first is the default). Server registry passes it through `GET /api/themes`.
- **Boot script:** read the saved accent for the theme (`saved.accents[id]`), `?accent=<id>` for one load; set `data-mt-accent` before the first paint (only when the theme lists accents; the script gets them from the saved record, so the first visit uses the CSS default).
- **Runtime (`theme.ts`, `ThemeRuntime`):** `setAccent(id)`, saved per theme in `meshterm.theme`; cleared when switching to a theme without accents; emits `theme:applied` so map paint, charts, sparklines and the favicon badge re-read tokens.
- **Tokens:** `--mt-text-faint`, `--mt-border-strong`, `--mt-accent-soft`, `--mt-accent-line`, `--mt-font-display-stretch` (default `100%`), `--mt-gauge-track`, `--mt-status-band-bg`. Defaults in `tokens.css` that derive from existing tokens so other themes keep working; `@group` comments for `docs:tokens`.
- **Default theme → Field Kit** (CR §5): `theme.json` name "Field Kit", `accents` (orange, amber, moss), preview colors; `theme.css` dark/light palettes with the OKLCH accent tokens; Archivo (variable, wdth) and JetBrains Mono as Latin-subset woff2 in `themes/default/fonts/` with `LICENSES.md`; `map-style.json` (dark: warm darkened raster; light: paper tone). Headings, tabs and page titles use `--mt-font-display` with the stretch token.
- **Classic** (CR §12 question 4): copy today's Default into `themes/classic/` as a built-in so the blue look stays available.
- **Appearance:** an Accent radiogroup (`accent-picker`, `accent-option` with state `active`) under the mode toggle, shown for themes with accents.
- **THEMING.md:** "Accents" section; regenerate the references.
- **Tests:** manifest validation (accents), boot script (saved accent, `?accent=`, unknown id ignored), runtime units (per-theme memory, clearing, event), Appearance component test, e2e (switch accent without reload; reload shows it before the app's JS; map and chart canvases recolor), axe for 3 accents × 2 modes, visual baselines for every screen in Field Kit Dark/Light (the old Default baselines move to Classic).

## Phase K1: shell — header tabs and faceplate

- **`AppShell`:** header with brand, the nav as tabs (keep the public `nav-item` / `nav-label` / `nav-badge` hooks, new variant `tab`; unread count badge on Messages), theme toggle, bell, `station-pill` (my node's short name, long name, `!id`; opens the existing node switcher). Remove the sidebar, its collapse button and `meshterm.sidebar` (ignore the stored value).
- **`StatusBand`** (`status-band` > `status-cell` with variant = field and state `ok`/`warn`/`error`): Link (state, host, reconnect countdown), Freq, Preset (SF/BW), Region, Ch util, Air TX, Battery, Last packet (ticks with `useNow`), Uptime. Data from the dashboard query and the device config query; dashes while loading or for viewers without config access.
- **`loraFrequency(config, channelName)`** in `packages/shared` (djb2 slot like the firmware, region band table, preset bandwidths, frequency override) with tests against the official apps' values.
- **Phones (< 768 px):** tabs in their own scrolling row; the band scrolls sideways; remove `nav-drawer` (CR question 1).
- **Retro, Amber, Cyberpunk:** CSS for the tabs and band (Retro: a reverse-video status line); keep their look otherwise.
- **Hooks:** add `station-pill`, `status-band`, `status-cell`; remove `sidebar`, `sidebar-footer`, `sidebar-nav`, `sidebar-toggle`, `nav-drawer*` and `nav-footer*` from the registry. Hooks are a public API, so list the removals under "Breaking changes for theme authors" in THEMING.md.
- **Tests:** `StatusBand` component (states, missing data), `loraFrequency` units, e2e (tabs navigate, unread badge, band shows the FakeNode's preset and frequency, no sideways page scroll at 390/768/1280/1440, keyboard order), crawl test, baselines for all themes.

## Phase K2: Overview

- **Hero (`overview-hero`):** a MapLibre instance (reuse the map page's style builder and token bridge, interactions off apart from pin clicks) with nodes heard in the last 2 h, clustering, range rings (5/10 km) and dashed direct links (shared layer builders, also used in K4); the headline and sentence from the dashboard DTO (`overview-headline`); legend pill; "Open full map". Pins open the drawer.
- **`ArcGauge`** (SVG, tokens only; `gauge` with variant `util`/`airtx`/`battery`, state by threshold): ch util with the 25 % tick, air TX, battery with voltage. Replaces the metric cards.
- **Needs a look:** `AttentionList` restyled (diamond markers).
- **Field log:** `ActivityFeed` rendered as a log table (`field-log`, rows keep the existing kinds and links).
- **Messages, 24 h:** `TrafficPanel` gains an area mode for received/sent with the util line and the 25 % threshold, plus three totals.
- **Roster:** `NodeCard` redesign (callsign, bearing arrow + compass point via a new `BearingArrow`, signal or hops, battery glyph, role · hardware, distance); Overview shows favorites then most recent, max 12, "All nodes ›".
- **Mesh detail** (CR question 2): `NetworkMap` and the packet-type chart in a collapsed `<details>` at the bottom (`mesh-detail`).
- **Tests:** gauge math and states, headline wording (singular/plural, nobody heard), roster cap and order, hero shows only recent nodes, e2e (pin opens drawer, open full map), baselines.

## Phase K3: Messages

- **List:** All / Channels / Direct filter (`conversation-filter`), channel tiles (`CH` + index) and DM callsign circles, lock icons, previews with the sender's callsign.
- **Thread header:** condensed name, meta line, key pill, "heard this hour" callsigns for channels, "On map" for DMs.
- **Bubbles:** `MessageItem` layout (incoming left with avatar, mine right in the accent tint), header line with distance · hops · SNR (hops from `hop_start − hop_limit`, distance from the sender's last position), grouping of consecutive messages, reply quote, delivery state inside the bubble; pill day separator and "NEW" line.
- **Composer:** pill field that grows, round send button, destination label and byte meter (`byte-meter`, state `near`/`over`).
- Retro's log-line treatment must still work (it styles the same hooks).
- **Tests:** grouping rules, hops/distance text, byte meter states, e2e send → queued → acked against FakeNode, Retro log lines unchanged, baselines.

## Phase K4: Map

- **Layout:** left tool column (`map-tools`: zoom, my node; layer toggles for links and rings, remembered in `meshterm.mapLayers`), compass (`map-compass`), "Nearest first" panel (`map-nearest`, desktop), bottom sheet (`map-sheet`) replacing the popover, with Message / Traceroute / Center / Details.
- **Layers:** direct links (my node → nodes heard directly, colored by SNR quality, SNR labels) and range rings (2/5/10 km), from the shared builders; both re-read tokens on `theme:applied`.
- **Pins:** teardrop symbol images generated from tokens (one per freshness state, plus my node), halo labels.
- **Topo tiles** (CR question 3): no code; document a topographic `tileUrl` example with its attribution and usage policy in the README.
- **Tests:** layer builders (only direct links, ring geometry), toggles remembered, sheet actions, e2e (select from list → sheet, Details opens the drawer, theme/accent switch keeps the camera), baselines with tiles stubbed as today.

## Phase K5: Nodes page and drawer

- **Nodes toolbar:** chips with counts (`filter-chip`), sort select, cards/table switch; role, power, has position and columns move into "More filters" (`filters-popover`); empty state.
- **Table:** callsign column, star, signal "relayed" for multi-hop, distance with `BearingArrow`.
- **Drawer header:** big callsign, copy `!id`, star, pills.
- **Overview tab:** 3 × 3 stat grid, notes (`detail-note` variants `battery-forecast`, `silent-router`), position block with the mini map and "N km DIR of you", recent messages from this node (server: `?from=<num>&limit=5` on the messages route if needed), device facts.
- **`batteryForecast(series)`** (linear fit; only when falling, < 50 % and a reasonable fit) in `dashboard/insights.ts`.
- **Telemetry / Signal tabs:** range picker restyle, threshold labels (low 20 %, critical 10 %, throttle 25 %, LongFast floor −17.5 dB) through the chart specs; notes for mains power, no telemetry and multi-hop nodes.
- **Raw tab:** highlighted JSON (`raw-json` with `raw-key`/`raw-value` spans).
- **Tests:** filter counts and sorts, forecast units, `?from=` route test, drawer component tests (each tab's notes), e2e keyboard (Esc, arrow keys between tabs, focus returns), baselines.

## Phase K6: Settings

- **Layout:** title + context line, section list (`settings-nav`) as a chip row on phones.
- **Device:** header card (`device-header`), section tiles (`device-section-tile`, state `current`) with one-line summaries from the registry.
- **LoRa:** frequency readout (`lora-frequency`, from `loraFrequency`), preset cards (`preset-card` radiogroup with SF · BW and data rate, faster ↔ farther scale), TX power slider bounded by the region's limit, hop limit stepper; Advanced in `<details>`.
- **Apply bar** (`apply-bar`): sticky, change count, reboot note, Discard, Review and apply; uses the existing edits store, `ReviewDialog` (add the "can't hear each other" warning for region/preset changes) and `ApplyProgress` (four steps).
- **Notifications and Appearance:** fieldset layout with switches (`switch`) and segmented controls; Appearance keeps the K0 accent picker.
- **Tests:** preset card selection → edit, frequency readout per region, apply bar counts and Discard, review warning, e2e LoRa change → review → apply → verified against FakeNode (config handshake only; FakeNode accepts the admin message, nothing goes on a real mesh), baselines.

## Phase K7: themes, baselines, docs

- Walk Retro, Amber and Cyberpunk over every new screen; fix their CSS; contrast passes.
- Full visual set: Field Kit Dark/Light, accent runs (Overview and Settings at 1280), Classic, Retro, Amber, Cyberpunk; win32 and linux; look at every new PNG.
- `architecture.md` (shell, new components, hooks, tokens, accents), `THEMING.md` (accents, new hooks, a Field Kit section as the reference theme), README screenshots, `DECISIONS.md`.

## Decisions to record when building

- Field Kit replaces the Default look under the id `default` so saved choices and tests keep working; the old look becomes the built-in `classic`.
- Accents are a generic theme feature (manifest + `data-mt-accent`), not a Field Kit special case.
- The mockup's generated contours aren't built; the hero and map use real tiles with the theme's map style.
- The sidebar and the phone nav drawer are removed in favor of header tabs and a tab row (overhaul O1's drawer decision is reversed).
- The topology and packet-type charts stay, folded into "Mesh detail".
- Fonts are bundled with the theme, never loaded from Google.
