# CR-005 — Field Kit: new default look and layout

| Field        | Value                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Project      | MeshTerm                                                                                                                                 |
| CR ID        | CR-005                                                                                                                                   |
| Title        | Field Kit redesign: outdoors / field-radio look, header tabs with a radio status band, map-led overview, reworked screens, theme accents |
| Requested by | Fireshaper                                                                                                                               |
| Date         | 2026-11-01                                                                                                                               |
| Priority     | High                                                                                                                                     |
| Type         | Enhancement (visual + layout)                                                                                                            |
| Depends on   | CR-004 (theme loader, modes, `map-style.json`, hook registry, per-theme baselines), CR-001 drawer, CR-002 device config, overhaul O1–O3  |
| Related      | `app-design-document.md` §8, `overhaul-plan.md`, `cr-004-themes.md`, `THEMING.md`                                                        |

Build plan: [cr-005-plan.md](cr-005-plan.md). Mockup: [mockups/field-kit/](mockups/field-kit/) (open `b-field-kit.html` in a browser; it uses example data).

---

## 1. Summary

Four visual directions were mocked up on 2026-11-01 (Ops Console, Field Kit, Spectrum, Beacon). The user picked **Field Kit** and asked to keep all of it, including all three accent colors. This CR makes Field Kit MeshTerm's default look and layout:

- **Look:** warm basalt neutrals in dark mode and a survey-paper light mode, signal-orange accent (amber and moss as alternatives), condensed uppercase display type for headings and callsigns, monospace for every reading.
- **Layout:** a header with tabs instead of the sidebar, and a "faceplate" band under it with the radio's live readings (link, frequency, preset, region, channel util, air TX, battery, last packet, uptime).
- **Screens:** a map-led Overview with gauges, a field log and a node roster; reworked Messages, Map, Nodes, node drawer and Settings (including LoRa preset cards and an apply bar).

The work is split into eight phases (§10). The first phase alone already changes the look of every screen, before any layout changes.

## 2. Decisions taken with the user (2026-11-01)

| Question              | Answer                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Mood                  | Mission control + outdoors / field radio                                                  |
| Mode                  | Dark first, light also fully designed                                                     |
| Layout freedom        | Rethink freely                                                                            |
| Home screen           | Network health                                                                            |
| Type                  | Technical sans + mono                                                                     |
| Density               | Balanced                                                                                  |
| Accent                | Keep all three (signal orange default, amber, moss) as a choice in Appearance             |
| Changes to the mockup | None: keep the faceplate band, condensed caps headings, terrain hero map and roster cards |

## 3. Current state (what this builds on)

- **Shell:** `AppShell` has a header (brand, `ConnectionIndicator`, bell, user menu), a collapsible `sidebar` from 768 px and a Radix `nav-drawer` below 768 px (overhaul O1 decision).
- **Default theme:** `themes/default/`, `colorScheme: "auto"`, a blue accent on slate; system fonts.
- **Theme system (CR-004):** registry, hot reload, `data-mt-theme` / `data-mt-mode`, boot script, `map-style.json`, effects, hook registry with an ESLint rule and a crawl test, generated token docs, per-theme visual baselines and axe contrast.
- **Dashboard (O1–O3):** `NetworkKpis` (6 metric cards), traffic panel, activity feed, `NetworkMap` topology, attention list, node previews.
- **Data the mockup needs, already available:** dashboard DTO (counts, util and air-TX series, battery series, last packet), activity feed, traffic buckets, node positions and distances (`geo.ts` has `bearingDegrees`), messages with `rx_snr`, `rx_rssi`, `hop_start`, `hop_limit`, `reply_id`, telemetry and signal history, device config (region, preset, hop limit, TX power) with apply and verify.

## 4. Out of scope

- The generated contour terrain in the mockup. It was drawn from noise because artifacts can't load map tiles. The app uses real tiles through `/api/tiles` (see §6.3).
- MGRS / lettered map grid labels (mockup only).
- New server-side data, apart from the small additions in §9.
- Restyling Retro Terminal and Cyberpunk beyond keeping them working on the new layout (§8).
- A per-user (account) theme or accent preference; it stays per browser plus the admin default, as in CR-004.

## 5. Visual language

### 5.1 Palette (Default theme, now named "Field Kit")

Dark (default):

| Token                                           | Value                                         |
| ----------------------------------------------- | --------------------------------------------- |
| `--mt-surface-bg` / `-sunken`                   | `#14120f` / `#0e0d0a`                         |
| `--mt-surface-raised` / `-elevated`             | `#1b1915` / `#25221c`                         |
| `--mt-border-color` / `--mt-border-strong`      | `#2f2b24` / `#443e34`                         |
| `--mt-text` / `-muted` / `-faint`               | `#efe9de` / `#b3a998` / `#918676`             |
| `--mt-status-ok` / `-warn` / `-error` / `-info` | `#a3c46f` / `#eeb544` / `#f06d5c` / `#7fbad3` |

Light ("survey paper"):

| Token                                           | Value                                         |
| ----------------------------------------------- | --------------------------------------------- |
| `--mt-surface-bg` / `-sunken`                   | `#ebe9e1` / `#e1ded4`                         |
| `--mt-surface-raised` / `-elevated`             | `#f7f6f1` / `#ffffff`                         |
| `--mt-border-color` / `--mt-border-strong`      | `#d3cec1` / `#bab3a3`                         |
| `--mt-text` / `-muted` / `-faint`               | `#1f1b15` / `#554d41` / `#685f52`             |
| `--mt-status-ok` / `-warn` / `-error` / `-info` | `#4f7a1f` / `#9a6400` / `#b93a2a` / `#2f7495` |

Accents are defined in OKLCH so one hue drives every accent-derived token (`--mt-accent`, `-soft`, `-line`, bubbles, chart series 1). Lightness and chroma come from the mode, the hue from the accent:

| Accent                  | Hue | Dark L / C  | Light L / C |
| ----------------------- | --- | ----------- | ----------- |
| Signal orange (default) | 52  | 0.76 / 0.16 | 0.60 / 0.17 |
| Amber                   | 78  | same        | same        |
| Moss                    | 128 | same        | same        |

`--mt-accent-text` is near-black in dark mode and white in light mode. All text pairs must pass WCAG AA in all six combinations (3 accents × 2 modes); the axe check (§11) enforces it.

### 5.2 Type

- **Display:** Archivo (variable, `wdth` 62–125, OFL) at `font-stretch` 66–85 % in uppercase for page titles, section headings, tabs, callsigns and gauge numbers.
- **Body:** Archivo at 100 % width.
- **Mono:** JetBrains Mono (OFL) for readings, IDs, times, units and labels in the faceplate.
- Fonts are bundled in `themes/default/fonts/` as Latin-subset `.woff2` (no Google Fonts: the CSP and offline installs). Licenses go in `themes/default/LICENSES.md`.
- New token `--mt-font-display-stretch` (default `100%`) so other themes can opt out of the condensed width.

### 5.3 Shape and detail

- Radii 4 / 8 / 12 px; pills fully rounded.
- Dashed hairlines inside cards (log rows, card footers, stat grids); solid borders around cards.
- Callsigns (short names) are big condensed text, not chips. Battery is a small battery glyph with a fill; signal is four bars plus the dB reading.
- Bearing arrows: a small filled arrow rotated to the bearing from my node, plus the compass point (NE, SW…).
- Motion stays small: a 0.2 s drawer slide, a bubble pop on send, the link dot blinking. All of it goes away under reduced motion.

## 6. Screens

The mockup is the reference for every screen. This section lists what each screen must do and what's new compared with the app today.

### 6.1 Shell

- **Header (58 px):** logo and wordmark; tabs Overview, Messages (unread count), Map, Nodes, Settings with a 3 px accent underline on the current one; on the right the theme toggle, the bell, and a station pill (my node's callsign, long name and `!id`) that opens the node switcher (multi-node).
- **Faceplate band (`status-band`):** a single row of label/value cells in mono with uppercase labels: Link (state + host), Freq, Preset (with SF/BW), Region, Ch util, Air TX, Battery (with voltage), Last packet, Uptime. It scrolls sideways when it doesn't fit and never wraps. The Link cell turns warn/error with the connection state and shows the reconnect countdown while reconnecting.
- **Phones (< 760 px):** the tabs move to their own scrollable row under the header; the faceplate scrolls sideways. This replaces the O1 nav drawer (see §12, question 1).
- The sidebar and its collapse setting (`meshterm.sidebar`) go away. Retro and Cyberpunk get the same structure (§8).

### 6.2 Overview (the dashboard)

Top to bottom, on a 12-column grid (8 + 4 on wide screens, stacked below 1100 px):

1. **Hero map (8 columns, 540 px tall):** my mesh on the real base map with Field Kit's map style, range rings at 5 and 10 km, dashed direct links, teardrop pins colored by last heard. A headline over the top-left in large condensed caps ("10 of 13 nodes on the air") with a sentence under it (heard direct, nearest, farthest), a top fade so the text stays readable, a legend pill and "Open full map". Clicking a pin opens the node drawer.
2. **Conditions (4 columns):** three arc gauges for my node: channel util (with a tick at the 25 % throttle point), air TX, battery (with voltage).
3. **Needs a look:** the attention list with diamond severity markers.
4. **Field log (5 columns):** the activity feed as a log table (time, callsign tag, entry, detail).
5. **Messages, 24 h (7 columns):** received and sent as stacked areas with channel util as a dashed line on the right axis, the 25 % line, and three totals underneath.
6. **Roster:** node cards, last heard first, each with the callsign, long name, bearing arrow, last heard, signal or hop count, battery, role · hardware and distance.

Scale (the user's real mesh has about 190 nodes):

- The hero map shows nodes heard in the last 2 hours (my node always), clustering with MapLibre when pins would overlap.
- The headline counts use the dashboard thresholds, not fixed numbers.
- The roster on the Overview shows favorites, then the most recently heard, capped at 12 cards, with "All nodes ›" to the Nodes page.
- The existing topology (`NetworkMap`) and packet-type traffic chart aren't in the mockup. They move to a "Mesh detail" section at the bottom of the Overview, collapsed by default (see §12, question 2).

### 6.3 Map

- Full-bleed MapLibre map with Field Kit's `map-style.json` (warm tint in dark, paper tone in light) over the configured tiles.
- **Left tool column:** zoom in/out, center on my node; a second group of layer toggles: direct links (with SNR labels), range rings (2/5/10 km).
- **Compass** in the top-right.
- **"Nearest first" panel** on the right (desktop): every node with a position, sorted by distance, with freshness dot, callsign, name and distance. Nodes without a position stay in the existing "Not on map (N)" list.
- **Bottom sheet** for the selected node (replaces the popover): callsign and name, pills (heard, role, solar), a stat grid (distance + bearing, signal, RSSI, battery, ch util, uptime), and Message / Traceroute / Center / Details. Full width on phones.
- Pins are teardrops with a dark halo label; selected pins grow.
- New map layers: direct links (my node to each node heard directly, colored by SNR quality) and range rings, both GeoJSON layers drawn by MeshTerm.
- Topographic tiles (§12, question 3) are the admin's choice through the existing `tileUrl` setting; the theme only tints.

### 6.4 Messages

- **List:** "MESSAGES" title, an All / Channels / Direct segmented filter, rows with a 46 px tile (`CH` + index for channels, the callsign in a circle for DMs), name, lock icon for private channels and PKI DMs, time, preview with the sender's callsign, unread count.
- **Thread header:** the conversation name in condensed caps, channel index and role or hops/distance/SNR for DMs, a key pill (default key / private / public-key encrypted / channel key only). For channels, the callsigns heard in the last hour ("+N heard this hour"). For DMs, "On map".
- **Bubbles:** incoming on the left with the callsign avatar at the bottom, a header line "name · distance · hops · SNR", reply quotes, time and delivery state inside the bubble; mine on the right in the accent tint. Consecutive messages from the same sender group. A pill day separator and a "NEW" line before unread messages.
- **Composer:** a rounded field that grows to 140 px and a round send button; under it the destination (`CH 0 · LongFast` or `DM · TRL`) and a thin byte meter that turns warn above 170 and error above 200 bytes.

### 6.5 Nodes

- Title "NODES" with the counts.
- **Toolbar:** search (name, short name, `!id`, hardware); filter chips with live counts: All, Heard 1 h, Direct, Routers, Favorites, Low battery (< 35 %), Silent 2 h+; sort (last heard, distance, signal, battery, name); cards/table switch.
- **Cards:** the roster card (§6.2) plus a favorite star.
- **Table:** callsign, name (+ star), role, heard, signal (bars + dB or "relayed"), hops, battery, distance with bearing arrow, hardware.
- The existing filters that aren't chips (role, power, has position, column picker) stay in a "More filters" popover.
- An empty state when nothing matches.

### 6.6 Node drawer

- **Header:** the callsign in 52 px condensed caps, the long name, `!id · hardware` with a copy button, favorite star, close; pills (heard, role, hops, solar, "New today").
- **Overview tab:** a 3 × 3 stat grid (last heard, hops, SNR, RSSI, distance, bearing, battery, ch util, uptime); a plain-language note when something needs attention (battery forecast, silent router); position with a small map and "8.2 km NW of you"; recent messages from this node (channels and DMs); device facts (hardware, firmware, public key shared or not).
- **Telemetry tab:** range picker (1h / 24h / 7d / 30d) and "Request now"; battery with 20 % / 10 % lines, voltage, radio load (ch util and air TX) with the 25 % line. Notes for mains-powered nodes and for "no telemetry in this range".
- **Signal tab:** SNR with the LongFast decode floor (−17.5 dB) and 0 dB lines, RSSI, an explanation of the scale; for nodes not heard directly, why there is no signal history and a pointer to traceroute.
- **Raw tab:** the stored NodeInfo as highlighted JSON.
- **Footer:** Message, Show on map, Traceroute (my node: Device settings).
- Charts keep uPlot; only their colors and fonts change (through tokens).

### 6.7 Settings

- Title "SETTINGS" with the node and the signed-in user; a left section list (Device, Notifications, Appearance, then Account, Users, Audit log) that becomes a scrolling chip row on phones.
- **Device:** a header card for my node (callsign, name, `!id`, role; hardware, firmware, region, when the config was read), then section tiles (icon, name, one-line summary) instead of the current list, scrolling sideways on phones.
- **LoRa:** the Radio fieldset (region, "use a modem preset", the frequency readout "906.875 MHz · slot 20 · from the primary channel name", preset cards showing name, SF · bandwidth and data rate on a faster ↔ farther scale); the Transmit fieldset (transmit, TX power slider with the region's limit, hop limit stepper with the airtime note); Advanced folded.
- **All device sections:** changed rows are tinted with a "changed" tag; a sticky apply bar ("2 unsaved changes · Saving LoRa settings reboots the node", Discard, Review and apply); the existing review dialog shows before → after and warns when a region or preset change would cut the node off; the existing apply progress is shown as the four steps (send, reboot, reconnect, read back and verify).
- **Notifications:** same settings as today, laid out as fieldsets with switches and selects.
- **Appearance:** theme cards with a mini preview, Mode (System / Light / Dark), **Accent** (radio pills, only for themes that offer accents), plus the existing effects and units settings.

## 7. Theme system additions

- **Accents in the manifest:** `theme.json` gets an optional `accents: [{ id, name, preview }]` (≤ 6; ids `[a-z0-9-]{1,20}`; first is the default). Validated by the existing Zod manifest.
- **Applying:** `<html data-mt-accent="<id>">`, set by the boot script before the first paint and by the runtime on change. Theme CSS selects on `:root[data-mt-accent="amber"]`. Themes without accents ignore it.
- **Saving:** the accent goes into the existing `meshterm.theme` record (per theme: `accents: { default: "amber" }`), so switching themes and back keeps each theme's accent.
- **`?accent=<id>`** forces an accent for one load (like `?theme=`), for tests and screenshots.
- `useThemeChange` consumers (map paint, charts, sparklines, favicon badge) re-read tokens on an accent change too: the runtime emits `theme:applied` after it changes the attribute.
- THEMING.md gets an "Accents" section; the generated references pick up the new tokens.

## 8. Other themes

- Retro Terminal, Retro Terminal Amber and Cyberpunk keep working on the new structure: header tabs, faceplate band, Overview layout, bottom sheet, drawer header, settings tiles. Their CSS is updated where the new hooks need it (e.g. the faceplate as a status line in Retro).
- They don't offer accents.
- Their visual baselines are re-recorded; their axe checks must pass.
- The theme guard stays: no component names a theme id.

## 9. Data and API

Mostly client work. Small additions:

| Need                                  | Change                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Faceplate: frequency, preset, region  | Client derives them from the stored device config (region, preset or custom BW/SF, channel name, frequency slot / override). A shared helper `loraFrequency()` computes the slot the way the firmware does (djb2 hash of the primary channel name, modulo the region's channel count) with tests against known values (US LongFast → slot 20 → 906.875 MHz). |
| Faceplate: firmware, uptime           | From my node's metadata and device metrics when present; a dash when not.                                                                                                                                                                                                                                                                                    |
| Roster / map: bearing and distance    | Client, from positions (`geo.ts`).                                                                                                                                                                                                                                                                                                                           |
| Message bubble: distance and hops     | Client: hops from `hop_start − hop_limit`, distance from the sender's last position.                                                                                                                                                                                                                                                                         |
| Drawer: battery forecast note         | Client insight from the 24 h battery series (linear fit; shown only when falling, under 50 % and the fit is reasonable). Unit-tested.                                                                                                                                                                                                                        |
| Drawer: recent messages from channels | `GET /api/connections/:id/messages?from=<num>&limit=5` if the current endpoint can't filter by sender; otherwise none.                                                                                                                                                                                                                                       |
| Overview headline numbers             | Existing dashboard DTO.                                                                                                                                                                                                                                                                                                                                      |

Nothing here transmits on the mesh. "Request now" and Traceroute are the existing admin actions with their existing confirmations.

## 10. Phases

| Phase | Deliverable                                                                                    | Est.            |
| ----- | ---------------------------------------------------------------------------------------------- | --------------- |
| K0    | Accents in the theme system; Field Kit palette, fonts and map style as the Default theme       | 1.5 days        |
| K1    | Shell: header tabs, station pill, faceplate band, phone tab row; Retro/Cyberpunk shell updates | 1.5–2 days      |
| K2    | Overview: hero map, gauges, needs a look, field log, messages chart, roster, mesh detail       | 2–2.5 days      |
| K3    | Messages                                                                                       | 1–1.5 days      |
| K4    | Map: layout, links and rings layers, nearest panel, bottom sheet                               | 1.5–2 days      |
| K5    | Nodes page and node drawer                                                                     | 1.5–2 days      |
| K6    | Settings: device header and tiles, LoRa cards and frequency, apply bar, Appearance accents     | 1.5–2 days      |
| K7    | Other themes, full baselines, contrast, docs                                                   | 1 day           |
|       | **Total**                                                                                      | **~11–14 days** |

Phases ship in order; each is releasable on its own.

## 11. Testing

- Unit and component tests for every new component and helper (`loraFrequency`, battery forecast, accent storage, filter counts, bearing formatting, gauge math).
- The hook registry gets every new hook; the crawl test (`hooks.spec.ts`) covers the new screens; the ESLint rule passes.
- e2e (desktop 1280 and mobile 390): tabs and faceplate, Overview at both widths with no sideways page scroll, drawer tabs and keyboard, map sheet, nodes filters and sort, LoRa change → review → apply against FakeNode, accent switching without reload and with no flash after a reload.
- Visual baselines: every screen × Field Kit Dark and Light × 1280/390 px, plus the accent variants on Overview and Settings at 1280; Retro and Cyberpunk re-recorded. Both win32 and linux sets, looked at before committing.
- axe contrast: Field Kit × 3 accents × 2 modes, Retro, Amber, Cyberpunk.
- Never transmit on the mesh in tests.

## 12. Open questions (defaults in bold, used unless the user says otherwise)

1. Phones: replace the O1 nav drawer with the **scrollable tab row from the mockup**, or keep the drawer?
2. Topology and packet-type charts: **a collapsed "Mesh detail" section at the bottom of the Overview**, or move them to the Nodes page, or drop them?
3. Topographic base map: **leave tiles to the admin's `tileUrl`** (the docs suggest a topo provider and its attribution and usage rules), or add a built-in "Topo" preset?
4. Theme name: keep the id `default` and **rename it to "Field Kit"**, keeping the old blue look as a separate built-in "Classic"? Or drop the old look?

## 13. Risks

| Risk                                                                          | Mitigation                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ~190 nodes overload the hero map, roster and faceplate                        | Time window and clustering on the map, capped roster, faceplate shows only my node's readings           |
| Condensed caps hurt readability                                               | Only for headings, tabs, callsigns and big numbers; body text at normal width; contrast checks          |
| Removing the sidebar breaks Retro/Cyberpunk layouts and hundreds of baselines | Structure changes in K1 come with their theme CSS fixes and re-baselining in the same phase             |
| Accent tokens in OKLCH aren't readable by canvas consumers                    | The token bridge already reads computed values; add a test that map and chart colors resolve to `rgb()` |
| Frequency slot calculation drifts from firmware                               | Tests against values from the official apps for several regions, presets and channel names              |
| Large CSS rewrite of the Default theme changes many hooks at once             | K0 changes only tokens and fonts; layout changes come phase by phase                                    |

## 14. Acceptance (overall)

- Every screen matches the mockup's structure and look in Field Kit Dark and Light, with all three accents.
- No sideways page scroll at 390, 768, 1280 and 1440 px.
- Retro Terminal, Amber and Cyberpunk work on the new layout and pass contrast.
- `typecheck`, `lint`, `format:check`, `docs:tokens --check`, `test`, `test:e2e` and the full visual set are green.
- `architecture.md`, `THEMING.md`, `progress.md` and `DECISIONS.md` are updated.
