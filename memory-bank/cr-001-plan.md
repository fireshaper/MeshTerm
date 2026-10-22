# CR-001 Node detail drawer — build plan

CR: [cr-001-node-drawer.md](cr-001-node-drawer.md). Stop after each phase, report, commit and push. Messages Phases 3–5 ([messages-plan.md](messages-plan.md)) wait until this CR is done.

## Where the code is today (2026-10-20)

- A node details drawer already exists: `NodeDetailsDrawer`, a Radix Dialog opened through `ui-store` `openNode(num)` from cards, the table, the feed, the network map and the DM header.
  - Data comes from the cached dashboard plus `GET …/nodes/:num/history` (24 h / 7 d).
  - One scrolling page, no tabs.
  - Charts are the in-house SVG `TimeChart`: no crosshair sync, zoom or bands. uPlot is in tech-stack.md but was never installed.
- Telemetry:
  - Typed columns for `device` (battery, voltage, channel util, air util TX, uptime) and three `environment` fields (temperature, humidity, pressure).
  - Every other field is dropped, and power and air-quality telemetry are ignored.
- There is no `packet_log`.
  - `packet_stats` counts packets per minute, node and port, so packets/hour is available.
  - Per-packet SNR/RSSI/hops history isn't kept. The node row holds only the latest values.
- Not built yet: auth and the viewer role, traceroute, request position, unit settings, and the Cyberpunk / Retro Terminal themes.

## Phase C1: data and API (done 2026-10-20)

- Migration 0009:
  - `telemetry`:
    - `kind` gains `power` and `air_quality`.
    - A new `metrics` JSON column holds every numeric field reported, with snake_case protobuf names.
    - The typed device and environment columns stay for the fast paths.
  - `nodes` gains:
    - `first_seen`.
    - `public_key` (hex; public keys are public; the fingerprint is its first 8 bytes).
    - `via_mqtt` (from the last packet).
  - New `signal_log`: `(connection_id, node_num, time, snr, rssi, hops, via_mqtt)`, one row per packet from another node, kept for 7 days (pruned like the activity log).
- Decoder: every telemetry variant (device, environment, power, air quality; local stats and health metrics are ignored) with all numeric fields.
- API:
  - `GET …/nodes/:num`: the CR's `NodeDetailDTO`.
  - `GET …/nodes/:num/telemetry?kind&from&to&metrics&bucket`:
    - Buckets: raw ≤ 2 h, 5 min ≤ 36 h, 30 min ≤ 8 d, else 2 h.
    - At most 1 000 points per series.
    - Each series carries avg, min and max.
  - `GET …/nodes/:num/signal?from&to`: SNR and RSSI (direct packets only), hops, and packets per bucket.
  - `GET …/nodes/:num/telemetry.csv?from&to`: streams raw rows.
- FakeNode history fixture (backdated packets through the control API and an e2e seed):
  - 30 d of device telemetry every 15 min.
  - A node on external power.
  - A reboot.
  - An environment node.
  - An INA power-monitor node.
  - A node with no telemetry.
  - A 6 h gap.
- Performance test: 30 d of one node in < 100 ms, measured on a 300-node × 30-day database.

## Phase C2: drawer shell and Overview (done 2026-10-20)

- The drawer is driven by a `?node=!hex` search param on any route. Esc, ✕ and mobile Back (history) close it and restore the view.
- Width: 480 px, resizable 400–800 px, remembered per browser. Full screen below 768 px.
- Header: status, names, ★, ⋯ menu, ✕; role · hardware · id (copy); seen · hops · firmware (own node only).
- Tabs: Overview, Telemetry, Signal, Raw.
  - Telemetry and Signal are lazy (they hold the uPlot chunk).
  - Neighbors and Traceroute are placeholders.
- Overview: identity (key fingerprint, PKI capable), status, power, radio, environment (only reported fields), position (mini map, copy, distance/bearing), 24 h stats.
- Raw tab: the latest NodeInfo/User/Position and the last telemetry of each kind as JSON.
- Entry points: dashboard, node list, map popup, DM header ⓘ, channel sender chip.
- Actions: Message and Show on map. Transmitting actions wait for their own CRs.

## Phase C3: charts (done 2026-10-20)

- uPlot, lazy-loaded, with a token bridge (`useChartTokens`, re-applied on theme change) and new chart/drawer tokens.
- Range picker: 1 h / 24 h / 7 d / 30 d / Custom. Shared by both tabs and remembered.
- Interaction:
  - Synced crosshair and tooltip.
  - Drag to zoom, double-click to reset.
  - Avg line with a min–max band.
  - Gaps break the line (3× the median interval).
- Telemetry charts:
  - Battery: a "Powered" band above 100, thresholds at 20 % and 10 %.
  - Uptime step chart with "Reboot" marks.
  - Environment, power and air-quality groups, driven by which fields are present.
- Signal tab charts, with the 7-day note.
- Data:
  - Live updates without a refetch (at most 1 render per second).
  - AbortController cancels the previous range.
  - CSV button.
- Accessibility: summaries plus a "View as table" option.
- Visual baselines.

## Phase C4 (optional, transmits): request telemetry (done 2026-10-22)

- Sends `TELEMETRY_APP` with `want_response` after a confirmation.
- Limits: once per node per 5 min, hidden for nodes more than 3 hops away, a 60 s timeout toast, covered by the no-transmit audit.
- Needs the user's go-ahead before it is built.

## Not applicable yet

- Viewer/admin roles (no auth).
- Unit settings: metric units for now.
- Firmware for other nodes (the mesh doesn't report it).
- "All three built-in themes": only Default exists.
