# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# IMPORTANT:

# Always read memory-bank/architecture.md before writing any code. Include entire database schema.

# Always read memory-bank/app-design-document.md before writing any code.

# After adding a major feature or completing a milestone, update memory-bank/architecture.md.

## Workflow

- Build in the order of [memory-bank/implementation-plan.md](memory-bank/implementation-plan.md).
- **Stop after every phase** and report to the user what was done before starting the next phase.
- After every phase, update [memory-bank/progress.md](memory-bank/progress.md) with what was done and any changes agreed between phases.
- **Commit only when the user asks.**

## Project status

**Base app complete** (Phases 0–11 of the implementation plan; M1 scope). History and agreed changes: [memory-bank/progress.md](memory-bank/progress.md). Next work (map, telemetry, themes, auth, …) is listed under "Out of scope" in the implementation plan and will be planned separately. Planning docs:

- [memory-bank/app-design-document.md](memory-bank/app-design-document.md) covers product scope, architecture, data model, theming rules and milestones (M1–M5).
- [memory-bank/tech-stack.md](memory-bank/tech-stack.md) covers library choices and tooling. It is newer than the design doc. Where they conflict, follow tech-stack.md. Exception: `engines.node` is **>=24** (local dev runs Node 24). The Docker image still uses `node:26-alpine`.
- [memory-bank/implementation-plan.md](memory-bank/implementation-plan.md) is the step-by-step build plan for the base app.

Record assumptions in [DECISIONS.md](DECISIONS.md) instead of stalling on ambiguity.

## Commands

Run from the repo root. When you add new commands, list them here.

```sh
# Setup and checks (CI runs: typecheck, lint, format:check, test:unit, test:int, test:e2e, docker build)
pnpm install                         # install (Node >= 24, pnpm 10)
pnpm typecheck                       # tsc --noEmit for the root configs and every package
pnpm lint                            # ESLint (type-aware) + Stylelint
pnpm lint:ts                         # ESLint only
pnpm lint:css                        # Stylelint only (literal colors banned outside themes/)
pnpm format                          # Prettier write
pnpm format:check                    # Prettier check

# Tests
pnpm test                            # all Vitest projects (unit + integration)
pnpm test:unit                       # skip *.int.test.ts
pnpm test:int                        # only *.int.test.ts
pnpm test -t "<test name>"           # one test by name (no `--`: pnpm forwards it literally)
pnpm --filter @meshterm/server test  # one package's tests
pnpm test:e2e                        # build the SPA, then Playwright (desktop 1280 px + mobile 390 px)
pnpm --filter @meshterm/web exec playwright install chromium   # once per machine
pnpm test:gate                       # base-app gate spec, three runs in a row
pnpm test:visual                     # visual baselines (channel, nodes, DM × 1280/390 px)
pnpm test:visual:update              # rewrite this platform's baselines after an intended UI change
pnpm test:visual:linux               # rewrite the Linux (CI) baselines in the Playwright Docker image

# Run locally
pnpm dev                             # server + web dev servers (copy .env.example to .env first)
pnpm dev:fake                        # same, plus a FakeNode on 127.0.0.1:4403
pnpm --filter @meshterm/fake-node cli inject --text "hi"       # make a running FakeNode hear a message
pnpm --filter @meshterm/server db:generate --name <name>       # new SQL migration from src/db/schema.ts

# Build
pnpm --filter @meshterm/web build    # SPA → apps/web/dist
pnpm --filter @meshterm/server build # server bundle → apps/server/dist/main.js (tsup)
pnpm --filter @meshterm/server start # run the bundle

# Docker
docker build -t meshterm .                                    # runtime image (default target)
docker compose -f compose.test.yml up --build                 # MeshTerm + FakeNode from source (MESHTERM_PORT=…)
docker compose -f compose.test.yml exec fakenode pnpm cli inject --text "hi"
docker compose up -d                                          # production (docker-compose.yml)
```

**Workspace imports:** packages depend on each other with `workspace:*` (e.g. `"@meshterm/shared": "workspace:*"`). Each package's `exports` points at `src/index.ts`, so there is no build step between packages.

Tests are `*.test.ts` (unit) or `*.int.test.ts` (integration), colocated under `src/`.

## What MeshTerm is

A self-hosted web client for Meshtastic nodes reachable over IP. It ships as one Docker container with one `/data` volume (db, themes, backups). The server keeps an always-on connection to one or more nodes, stores everything in SQLite, and serves a browser UI. Any number of browser tabs share the same live state, and every visual detail comes from drop-in CSS themes.

## Layout

pnpm monorepo: `apps/server` (Fastify), `apps/web` (React 19 + Vite SPA served by Fastify), `packages/shared` (Zod schemas, DTOs and WS event types shared by both), `packages/protocol` (protobuf codec + stream framer; the only package that imports `@meshtastic/protobufs`), `packages/fake-node` (test double).

## Architecture (big picture)

```
Node(s) ──TCP 4403 / HTTP──▶ NodeConnection ──▶ Event hub ──▶ SQLite (/data/meshterm.db)
                                                   └──▶ WebSocket hub ──▶ browsers
Browser ──REST──▶ API ──commands──▶ NodeConnection
```

- **The server is the only radio client.** The browser never talks to a node directly.
- **Transport is pluggable** behind a `Transport` interface (TCP first, HTTP fallback in M5; BLE/serial come later). Use the official `@meshtastic/core`, `transport-node`, `transport-http` and `protobufs` packages, and never hand-write protobufs. Pin exact versions.
- **Connection state machine:** `disconnected → connecting → configuring → connected`. On failure it goes to `reconnecting` with exponential backoff (2 s → 60 s) and jitter, and never gives up. Configuring means sending `want_config_id` and waiting for the matching `config_complete_id`.
- **TCP framing:** the header is `0x94 0xC3 <len_hi> <len_lo>`. A length over 512 means resync.
- **Multi-node:** all persisted data is keyed by `connection_id`.
- **Outbound message status:** `queued → sent → acked | failed`, driven by routing ACK/NAK.
- **WebSocket protocol:** the client sends `subscribe` and the server replies with a `snapshot`, then sends deltas (`connection.state`, `node.upsert`, `message.new`, `message.status`, `telemetry.new`, `position.new`, `traceroute.result`, `config.updated`, `log.packet`, `theme.changed`). On the client, WS events patch the TanStack Query cache. Zustand holds connection state and UI prefs.
- The SQLite tables are listed in the design doc §7. `packet_log` is a 7-day ring buffer. Raw channel PSKs are never sent to viewers.

## Theming rules (enforced by lint, so don't break them)

1. Components use `--mt-*` design tokens only. No literal colors, fonts, radii, shadows or px values in `style={}`. Stylelint bans hex/rgb/hsl outside `themes/`.
2. Every meaningful element gets `data-mt="<component>"` plus `data-mt-state` / `data-mt-variant`. These attributes are a public, documented API, so treat renames as breaking changes.
3. Base CSS goes in `@layer base` and themes in `@layer theme`, so themes override without `!important`.
4. Icons are inline SVG (Lucide) using `currentColor`.
5. Themes are CSS and assets only, never JavaScript. A theme is `themes/<id>/` with `theme.json` + `theme.css` (+ optional fonts/assets/sounds/`map-style.json`). Themes hot-reload from `/data/themes` via chokidar.
6. Use Radix _unstyled_ primitives only. Don't use Tailwind, CSS-in-JS or pre-styled kits (MUI, Mantine, shadcn defaults).
7. Visual effects go in the `data-mt="fx-layer"` overlay and must honor `prefers-reduced-motion` and the "disable effects" toggle.

The built-in themes are Default (the reference for every token), Cyberpunk and Retro Terminal. `THEMING.md` documents tokens and hooks.

## Testing rules

- CI runs against `FakeNode`, a TCP server that speaks the real framing and replays recorded `FromRadio` frames. `meshtasticd` in simulator mode is optional for integration tests.
- Playwright visual regression covers every main screen × every built-in theme (base app: channel, node list, DM × 390/1280 px, Default theme). Baselines are per platform. **After an intended UI change, update both**: `pnpm test:visual:update` (your OS) and `pnpm test:visual:linux` (CI), and look at the new PNGs before committing.
- **Never transmit on the mesh** during startup, tests or migrations, apart from the config handshake and heartbeats.
