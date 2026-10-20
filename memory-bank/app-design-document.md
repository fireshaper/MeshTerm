# MeshTerm — App Design Document

Self-hosted, themeable web client for Meshtastic nodes reachable over IP.

## 1. Purpose

MeshTerm runs in a single Docker container, holds a persistent connection to one or more Meshtastic nodes over TCP (port 4403) or HTTP, and serves a browser UI for messaging, node monitoring, mapping, telemetry and device config. The entire look is driven by drop-in CSS themes (e.g. Cyberpunk, Retro Terminal).

## 2. Goals / Non-goals

**Goals**

- Connect to a WiFi/Ethernet node or `meshtasticd` by IP/hostname.
- Always-on server connection so history accumulates with no browser open.
- Any number of browsers/devices share the same live state.
- Theme = folder with `theme.json` + `theme.css`; no rebuild to add one.
- One container, one volume, compose-manager friendly (Komodo, Portainer).

**Non-goals (v1)**

- Bluetooth/serial transports (keep the transport layer pluggable).
- Firmware flashing/OTA, MQTT bridging, multi-tenant hosting.

## 3. Architecture

```
Meshtastic node(s) ──TCP 4403 / HTTP──▶ NodeConnection (server = only radio client)
                                              │
                                         Event hub ──▶ SQLite (/data/meshterm.db)
                                              │
                                        WebSocket hub ──▶ Browser SPA (any # of tabs)
Browser ──REST──▶ REST API ──commands──▶ NodeConnection
Theme loader (/data/themes) ──CSS/fonts──▶ Browser
```

- The browser never talks to the node directly; the server owns the single API connection.
- Connection states: `disconnected → connecting → configuring → connected`, with `reconnecting` on failure (exponential backoff 2 s → 60 s, jitter, never gives up).

## 4. Tech Stack

| Layer         | Choice                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Runtime       | Node.js 22 LTS, TypeScript                                                                              |
| Mesh protocol | `@meshtastic/core`, `@meshtastic/transport-node`, `@meshtastic/transport-http`, `@meshtastic/protobufs` |
| Server        | Fastify + `@fastify/websocket`                                                                          |
| Database      | SQLite (`better-sqlite3`) + Drizzle ORM                                                                 |
| Frontend      | React + Vite, TanStack Query, Zustand                                                                   |
| Map / charts  | MapLibre GL JS / uPlot                                                                                  |
| Styling       | CSS custom properties, cascade layers                                                                   |
| Packaging     | Multi-stage Dockerfile, docker-compose, amd64 + arm64                                                   |

## 5. Node Connectivity

- **TCP (primary):** 4-byte frame header `0x94 0xC3 <len_hi> <len_lo>`; length > 512 = resync. Send `want_config_id` on connect, wait for matching `config_complete_id`. Periodic heartbeat.
- **HTTP (fallback):** `PUT /api/v1/toradio`, poll `GET /api/v1/fromradio?all=false` until empty.
- **Multi-node:** each connection has `id, name, host, port, transport, enabled`; all data keyed by `connection_id`.
- **Outbound messages:** track `queued → sent → acked | failed` via routing ACK/NAK.

## 6. Features (v1)

| Area            | Scope                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard       | Default landing view: mesh status strip + per-node cards (last seen, power, role, hw, mini map, signal, telemetry). See `dashboard-spec.md`                                                                                               |
| Connection      | Status pill, node switcher, firmware/uptime                                                                                                                                                                                               |
| Channels        | Tabs 0–7, unread counts, send/receive, reactions                                                                                                                                                                                          |
| Direct messages | Per-peer conversations, PKI indicator, ACK status                                                                                                                                                                                         |
| Node list       | Sortable/filterable: name, ID, hw, role, last heard, hops, SNR, battery, distance                                                                                                                                                         |
| Node detail     | Info, position, metrics, neighbors; DM, request position, traceroute, remove                                                                                                                                                              |
| Map             | Standalone page (`/map`, own nav item): pannable/zoomable OpenStreetMap with a marker for every node ever seen. Later: neighbor links, traceroute paths, position trails, range rings, themeable via token bridge. See `map-view-spec.md` |
| Telemetry       | Battery, voltage, channel util, environment; 1 h – 30 d                                                                                                                                                                                   |
| Config          | Device, Position, Power, Network, Display, LoRa, Bluetooth + common modules                                                                                                                                                               |
| Actions         | Reboot, shutdown, factory reset, reset NodeDB (with confirmation)                                                                                                                                                                         |
| Logs            | Live decoded packet log + raw debug console                                                                                                                                                                                               |
| Notifications   | Browser notifications/sounds for DMs and mentions                                                                                                                                                                                         |
| Settings        | Theme picker, units, time format, map tiles, node connections                                                                                                                                                                             |

Responsive: bottom tab bar at 390 px; three-pane layout at ≥ 1200 px.

## 7. Data Model (SQLite)

| Table         | Purpose                                                             |
| ------------- | ------------------------------------------------------------------- |
| `connections` | Configured nodes                                                    |
| `nodes`       | NodeDB per connection (names, hw, role, last heard, SNR, favorites) |
| `positions`   | Position history                                                    |
| `telemetry`   | Device / environment / power metrics (JSON payload)                 |
| `messages`    | Channel + DM messages with status and signal info                   |
| `channels`    | Channel config (no raw PSK to viewers)                              |
| `traceroutes` | Route out/back with per-hop SNR                                     |
| `packet_log`  | Ring buffer, 7 days                                                 |
| `settings`    | Theme, units, notification rules                                    |

**WebSocket:** client sends `subscribe`; server returns a `snapshot`, then deltas (`connection.state`, `node.upsert`, `message.new`, `message.status`, `telemetry.new`, `position.new`, `traceroute.result`, `config.updated`, `log.packet`, `theme.changed`).

## 8. Theming

**Rules**

1. Components use design tokens only — no literal colors, fonts, radii or shadows. Lint enforces it.
2. Every meaningful element has `data-mt="<component>"` plus `data-mt-state` / `data-mt-variant` hooks (public, documented API).
3. Base CSS in `@layer base`, theme CSS in `@layer theme` — themes win without `!important`.
4. Icons are inline SVG using `currentColor`.
5. Themes are CSS + assets only. Never JavaScript.

**Package layout**

```
themes/<id>/
  theme.json      # id, name, author, version, colorScheme, preview, effects
  theme.css       # token overrides + optional component overrides
  fonts/  assets/  sounds/
  map-style.json  # optional MapLibre style
```

**Token groups:** surface, text, accent/status, message bubbles, signal scale, typography, shape, motion, map, charts (all prefixed `--mt-`).

**Effects layer:** optional `data-mt="fx-layer"` overlay for scanlines/glow/CRT; honors `prefers-reduced-motion` and a "disable effects" toggle.

**Built-in themes**

- **Default** — neutral light/dark, reference for every token.
- **Cyberpunk (Neon District)** — near-black, hot pink + cyan, glow, angled panels, scanlines, neon map.
- **Retro Terminal** — green/amber phosphor, monospace, no radius, CRT vignette, IRC-style message lines.

Themes in `/data/themes` hot-reload. `THEMING.md` documents tokens, hooks and a first-theme walkthrough.

## 9. Security & Deployment

- Local auth on by default (argon2id, HTTP-only cookies); roles `admin` and `viewer`; optional reverse-proxy header auth from trusted CIDRs.
- WS requires session; CSRF on admin endpoints; rate limits on login and outbound sends; audit log for config changes.
- `GET /healthz`, JSON logs to stdout, nightly SQLite backup to `/data/backups` (keep 7).

```yaml
services:
  meshterm:
    image: ghcr.io/<you>/meshterm:latest
    restart: unless-stopped
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      - TZ=America/New_York
      - MESHTERM_AUTH=local
      - MESHTERM_NODE_HOST=192.168.1.50
      - MESHTERM_NODE_PORT=4403
```

## 10. Milestones

| #   | Milestone | Scope                                                 | Gate                                            |
| --- | --------- | ----------------------------------------------------- | ----------------------------------------------- |
| M1  | Connect   | TCP + reconnect, channels/DMs, SQLite, WS, token rule | Recovers from node reboot; two browsers in sync |
| M2  | Mesh view | Node list/detail, map, traceroute                     | Matches the phone app's node list               |
| M3  | Themes    | Loader, 3 built-in themes, THEMING.md                 | Full restyle via `theme.css` only               |
| M4  | Operate   | Telemetry, config editor, logs, actions               | Config edit round-trips after reboot            |
| M5  | Release   | Auth/roles, HTTP fallback, multi-node, arm64          | Fresh Pi install working in < 5 min             |

## 11. Notes for AI Developers

- Use the official `@meshtastic/*` packages; never hand-write protobufs.
- Build a `FakeNode` that speaks real TCP framing; CI runs against it. Optional `meshtasticd` simulator for integration tests.
- Record assumptions in `DECISIONS.md` instead of stalling.
- Screenshot every main screen in all three themes per milestone; Playwright visual regression.
- Never transmit on the mesh during startup, tests or migrations beyond the config handshake and heartbeats.
