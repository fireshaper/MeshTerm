# CR-001 — Node Detail Drawer with Telemetry Charts

| Field         | Value                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Project       | MeshTerm                                                                                           |
| CR ID         | CR-001                                                                                             |
| Title         | Node detail drawer with telemetry charts                                                           |
| Requested by  | Fireshaper                                                                                         |
| Date          | 2026-10-20                                                                                         |
| Priority      | High (next feature)                                                                                |
| Type          | Enhancement                                                                                        |
| Depends on    | Existing `nodes`, `telemetry`, `positions`, `packet_log` tables; dashboard, map and messages views |
| Related specs | `app-design-document.md` §6, `dashboard-spec.md`, `map-view-spec.md`, `messages-spec.md`           |

---

## 1. Summary

Add a slide-over **node detail drawer** that opens from anywhere a node appears (dashboard card, node list, map marker, message header). It shows everything known about that node and **interactive time-series charts** for its telemetry: battery, voltage, channel and airtime use, environment sensors and signal quality, over selectable time ranges.

## 2. Motivation

- The dashboard shows only the latest values and a 24 h battery sparkline. There's no way to see trends ("is this solar node actually charging?", "when did it drop off?", "is channel use creeping up?").
- Telemetry is already being stored but never shown in depth.
- Several existing views already have "Details" links that need a real destination.

## 3. Current behavior

- "Details" on dashboard cards and map popups opens a basic panel (or nothing) with static latest values.
- No historical telemetry is visible anywhere except the dashboard sparkline.

## 4. Scope

### In scope

- Drawer component, routing and entry points
- Overview tab: identity, status, latest metrics, position, actions
- Telemetry tab: charts for device, environment, power and air-quality metrics
- Signal tab: SNR/RSSI/hops history for directly heard packets
- Time range selector, synced crosshair, min/max bands, CSV export
- Server endpoint for downsampled telemetry series
- Live updates while the drawer is open
- Theming of charts via token bridge
- Optional "Request telemetry" action (admin, see §7.5)

### Out of scope (future CRs)

- Remote admin/config of the remote node
- Alert rules on telemetry thresholds
- Neighbor and traceroute history tabs (placeholders only)
- Comparing multiple nodes on one chart

## 5. UX

### 5.1 Entry points

| From           | Action                                                                   |
| -------------- | ------------------------------------------------------------------------ |
| Dashboard card | "Details" button, Enter on focused card                                  |
| Node list row  | Click row                                                                |
| Map            | "Details" in marker popup / selection bar                                |
| Messages       | ⓘ in DM header; click sender chip in channel                             |
| Anywhere       | Deep link `?node=!a1b2c3d4` on any route opens the drawer over that view |

The drawer overlays the current view, so closing it returns the user exactly where they were. Esc closes it; back button on mobile closes it.

### 5.2 Layout

```
┌──────────────────────────────────────────┐
│ ● K7AB  Kevin's Base           ★  ⋯   ✕ │  header
│ ROUTER · Heltec V3 · !a1b2c3d4  (copy)   │
│ Seen 3 min ago · 1 hop · fw 2.x          │
├──────────────────────────────────────────┤
│ [Overview] [Telemetry] [Signal] [Raw]    │  tabs
├──────────────────────────────────────────┤
│ Range: [1h] [24h] [7d] [30d] [Custom…]   │  (Telemetry/Signal only)
│ ┌──────────────────────────────────────┐ │
│ │ Battery %          ▁▂▃▅▆▇▇▆▅▄       │ │
│ ├──────────────────────────────────────┤ │
│ │ Voltage V                            │ │
│ ├──────────────────────────────────────┤ │
│ │ Channel util %  ── Air util TX %     │ │
│ └──────────────────────────────────────┘ │
│ [Export CSV]                             │
├──────────────────────────────────────────┤
│ [Message] [Traceroute] [Show on map]     │  action bar
└──────────────────────────────────────────┘
```

- **Desktop:** right-side drawer, 480 px wide, resizable 400–800 px (width remembered per browser).
- **Mobile (< 768 px):** full-screen sheet.

### 5.3 Overview tab

| Section       | Content                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity      | Long/short name, node ID, node number (decimal + hex), hardware model, role, firmware (if known), public key fingerprint (first 8 bytes, copyable), "PKI capable" yes/no |
| Status        | Last heard (relative + absolute), first seen, hops away, via MQTT, favorite/ignored                                                                                      |
| Power         | Battery % or "Powered" (> 100), voltage, uptime                                                                                                                          |
| Radio         | Channel util, air util TX, last SNR/RSSI if heard directly                                                                                                               |
| Environment   | Latest temperature, humidity, pressure, gas resistance, lux, etc. Only metrics the node reports.                                                                         |
| Position      | Mini map (same static-tile component as dashboard), lat/lon (copyable), altitude, precision, position age, distance/bearing from my node, "Show on map"                  |
| Summary stats | 24 h: packets heard, messages from this node, min/max battery                                                                                                            |

### 5.4 Telemetry tab

One stacked chart per metric group. Groups only render if the node has data for them in the selected range.

| Group         | Metrics (from telemetry protobufs)                                                                     | Chart                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Battery       | `battery_level`                                                                                        | Line, 0–100 % axis, threshold lines at 20 % (warn) and 10 % (danger). Values > 100 shown as a "Powered" band, not plotted as %. |
| Voltage       | `voltage`                                                                                              | Line, auto-scaled                                                                                                               |
| Radio load    | `channel_utilization`, `air_util_tx`                                                                   | Two lines, shared % axis, threshold lines from Settings                                                                         |
| Uptime        | `uptime_seconds`                                                                                       | Step line; drops to 0 mark reboots, annotated "Reboot"                                                                          |
| Environment   | `temperature`, `relative_humidity`, `barometric_pressure`, `gas_resistance`, `lux`, `wind_speed`, etc. | One small chart per metric present                                                                                              |
| Power monitor | `ch1_voltage`/`ch1_current` … `ch3_*`                                                                  | Voltage and current per channel                                                                                                 |
| Air quality   | `pm10_standard`, `pm25_standard`, `pm100_standard`                                                     | Lines                                                                                                                           |

**Chart behavior**

- Library: uPlot (already in stack).
- Time ranges: 1 h, 24 h (default), 7 d, 30 d, Custom (date-time pickers). Selection is shared between Telemetry and Signal tabs and remembered per browser.
- **Synced crosshair** across all charts in the tab; tooltip shows every series value at that time.
- Drag on a chart to zoom into that time window; double-click to reset to the selected range.
- For bucketed ranges, draw **avg as the line and min–max as a translucent band**.
- **Gaps:** if no sample for more than 3× the node's typical interval, break the line instead of interpolating.
- Units follow Settings (°C/°F, hPa/inHg, metric/imperial).
- Empty state per group: "No [group] telemetry in this range." If the node has never sent telemetry: explanation that the node needs the Telemetry module enabled.
- **Export CSV:** downloads the visible range for all groups (raw samples, not bucketed, up to 30 d).

### 5.5 Signal tab

| Chart        | Source                                                           |
| ------------ | ---------------------------------------------------------------- |
| SNR          | `rx_snr` of packets from this node heard **directly** (hops = 0) |
| RSSI         | `rx_rssi` of the same packets                                    |
| Hops away    | `hop_start - hop_limit` per received packet, step chart          |
| Packets/hour | Count of packets from this node, bar chart                       |

Source is `packet_log` (7-day retention), so ranges beyond 7 d show a note: "Signal history is kept for 7 days."

### 5.6 Raw tab

- Latest `NodeInfo`, `User`, `Position`, and the last telemetry packet of each kind as pretty-printed JSON, with copy buttons.
- Useful for debugging; collapsed sections by default.

### 5.7 Actions

| Action             | Who   | Notes                                                                |
| ------------------ | ----- | -------------------------------------------------------------------- |
| Message            | admin | Opens `/messages/dm/:nodeId`                                         |
| Traceroute         | admin | Existing traceroute flow; result shown in a toast with "View on map" |
| Show on map        | all   | `/map?node=`                                                         |
| Request position   | admin | Existing action                                                      |
| Request telemetry  | admin | See §7.5                                                             |
| Favorite / Ignore  | admin | Menu                                                                 |
| Remove from NodeDB | admin | Menu, confirmation                                                   |

Viewer role sees all data and charts, no actions that transmit or modify.

## 6. Data and API

### 6.1 Node detail

`GET /api/connections/:id/nodes/:num`

```ts
interface NodeDetailDTO extends NodeCardDTO {
  // from dashboard-spec
  firstSeen: string | null;
  firmware: string | null;
  publicKeyFingerprint: string | null;
  viaMqtt: boolean;
  powerMetrics: Record<string, number> | null;
  airQuality: Record<string, number> | null;
  environmentAll: Record<string, number> | null; // every env field reported
  stats24h: {
    packets: number;
    messages: number;
    batteryMin: number | null;
    batteryMax: number | null;
  };
  telemetryKinds: Array<"device" | "environment" | "power" | "air_quality">; // kinds ever reported
}
```

### 6.2 Telemetry series

`GET /api/connections/:id/nodes/:num/telemetry?kind=device&from=…&to=…&metrics=battery_level,voltage`

```ts
interface SeriesResponse {
  kind: string;
  bucketSeconds: number; // 0 = raw samples
  t: number[]; // epoch seconds, bucket start
  series: Record<
    string,
    {
      avg: (number | null)[];
      min?: (number | null)[]; // omitted when raw
      max?: (number | null)[];
    }
  >;
}
```

- **Bucketing** (server picks automatically unless `bucket=` is passed):

  | Range  | Bucket |
  | ------ | ------ |
  | ≤ 2 h  | raw    |
  | ≤ 36 h | 5 min  |
  | ≤ 8 d  | 30 min |
  | > 8 d  | 2 h    |

- Hard cap 1 000 points per series; widen the bucket if exceeded.
- Implement with a single SQL query per kind using `json_extract` on the payload and `GROUP BY rx_time / bucket`. If that's too slow on SQLite at 30 d, add generated columns for the common device metrics (`battery_level`, `voltage`, `channel_utilization`, `air_util_tx`) with an index on `(connection_id, node_num, kind, rx_time)`.
- Target: < 100 ms for 30 d of one node.

`GET /api/connections/:id/nodes/:num/signal?from=&to=` returns the same shape with `snr`, `rssi`, `hops`, `packets` series, built from `packet_log`.

`GET /api/connections/:id/nodes/:num/telemetry.csv?from=&to=` streams raw rows for all kinds.

### 6.3 Live updates

- While the drawer is open, the client listens for `telemetry.new`, `node.upsert` and `position.new` for that node.
- New samples are appended to the chart data in place (raw ranges) or merged into the current bucket (bucketed ranges), without refetching.
- Charts re-render at most once per second.

## 7. Technical notes

### 7.1 Component

- `NodeDrawer` mounted once at the app root and driven by the `node` query param, so every view gets it for free.
- Tabs lazy-load: the Telemetry and Signal tabs code-split uPlot so the Overview opens instantly.

### 7.2 Theming

uPlot draws on canvas, so use the same token bridge approach as the map (`map-view-spec.md` §6):

- `useChartTokens()` reads `--mt-chart-1…6`, `--mt-chart-grid`, `--mt-chart-axis`, `--mt-text-muted`, `--mt-font-mono`, `--mt-warning`, `--mt-danger` from computed style.
- Applies them to series stroke, band fill (series color at 20 % alpha via `color-mix`), grid, axes and threshold lines.
- Re-applies on theme change without remounting.

New tokens: `--mt-chart-band-alpha` (default 0.2), `--mt-chart-crosshair`, `--mt-chart-threshold-warn` (default `--mt-warning`), `--mt-chart-threshold-danger` (default `--mt-danger`), `--mt-drawer-width`, `--mt-drawer-bg` (default `--mt-bg-elevated`), `--mt-drawer-shadow`.

HTML hooks: `data-mt="node-drawer"`, `"node-drawer-header"`, `"node-drawer-tabs"`, `"node-drawer-tab"` (state `active`), `"range-picker"`, `"chart-group"` (variant = group name), `"chart-tooltip"`, `"chart-empty"`, `"node-drawer-actions"`, `"raw-json"`.

### 7.3 Accessibility

- Drawer is a modal dialog with focus trap and labelled title; focus returns to the trigger on close.
- Each chart has an accessible summary (`aria-label`: "Battery, 24 h: min 61 %, max 98 %, latest 78 %") and a "View as table" toggle.

### 7.4 Performance

- Opening the drawer: ≤ 2 requests (detail + first visible tab's series).
- Switching ranges cancels in-flight requests (AbortController).
- 30-day range for a node reporting every 15 min renders in < 200 ms.

### 7.5 Request telemetry (optional, admin only)

- Sends a `TELEMETRY_APP` request with `want_response` to the node for the selected kind.
- **This transmits on the mesh.** Rate-limit to once per node per 5 min; show a confirmation explaining it uses airtime; button hidden for nodes more than 3 hops away.
- Response arrives as a normal telemetry packet; show a toast when received or after a 60 s timeout.
- Must be covered by the no-transmit audit (never fires automatically).

## 8. Acceptance criteria

- [ ] Drawer opens from dashboard, node list, map and messages, and via `?node=` deep link on any route
- [ ] Esc / ✕ / mobile back close it and return to the same view and scroll position
- [ ] Overview shows identity, status, power, radio, environment, position with mini map, and 24 h stats
- [ ] Telemetry tab renders only the groups the node reports; ranges 1 h / 24 h / 7 d / 30 d / custom work
- [ ] Bucketed ranges show avg line + min–max band; gaps are broken, not interpolated
- [ ] Battery > 100 shown as "Powered", not plotted as a percentage
- [ ] Reboots visible on the uptime chart
- [ ] Crosshair and tooltip synced across charts; drag-to-zoom and reset work
- [ ] Signal tab shows SNR/RSSI for directly heard packets, hops and packet rate, with the 7-day note
- [ ] CSV export downloads raw samples for the selected range
- [ ] New telemetry arriving while open appears without a refetch
- [ ] Theme switch recolors charts instantly; all three built-in themes styled; Playwright screenshots added
- [ ] Viewer role sees data but no transmitting/modifying actions
- [ ] Telemetry API responds < 100 ms for 30 d of one node; ≤ 1 000 points per series
- [ ] Request telemetry is admin-only, confirmed, rate-limited and never automatic
- [ ] FakeNode fixtures: node with device telemetry every 15 min for 30 d, node on external power, node with a reboot, environment-sensor node, INA power-monitor node, node with no telemetry, node with a 6 h data gap

## 9. Risks

| Risk                                                      | Mitigation                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `json_extract` aggregation slow on large telemetry tables | Generated + indexed columns for common metrics; measure with a 300-node × 30-day fixture before shipping                   |
| Inconsistent telemetry intervals between nodes            | Gap detection uses the node's median interval, not a fixed value                                                           |
| Firmware adds new telemetry fields                        | Render unknown numeric fields in Raw tab; environment charts are driven by which fields are present, not a hard-coded list |
| Canvas charts ignore CSS themes                           | Token bridge with re-apply on theme change (§7.2)                                                                          |

## 10. Estimate

| Part                                                 | Effort              |
| ---------------------------------------------------- | ------------------- |
| Drawer shell, routing, entry points, Overview        | 1–1.5 days          |
| Telemetry + signal API with bucketing and tests      | 1–1.5 days          |
| Charts, range picker, crosshair, bands, live updates | 1.5–2 days          |
| Theming, a11y, CSV, Raw tab, fixtures, Playwright    | 1 day               |
| **Total**                                            | **~4.5–6 dev days** |
