# MeshTerm — Recommended Tech Stack

_As of 2026-10-19_

## Recommendation in one line

**TypeScript everywhere**: Node.js 26 LTS + Fastify on the server, React + Vite on the client, SQLite via Drizzle, and the official `@meshtastic/*` JS packages for the radio link. One language, shared types from server to browser, and a maintained protocol library.

## Why TypeScript over Python

| Factor                                          | TypeScript/Node                                                                   | Python (FastAPI + `meshtastic`)                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Official Meshtastic library                     | `@meshtastic/core` + TCP/HTTP transports, maintained in the official web monorepo | `meshtastic` Python lib, also official and mature                                   |
| Shared types server ↔ browser                   | Yes — one `packages/shared` for DTOs and WS events                                | No — duplicate models or generate from OpenAPI                                      |
| Async model for long-lived sockets + WS fan-out | Native event loop, fits naturally                                                 | Python lib's TCPInterface is thread/callback-based; bridging into asyncio adds glue |
| Frontend is JS anyway                           | One toolchain, one test runner                                                    | Two ecosystems                                                                      |
| AI-dev reliability                              | Very high for this stack                                                          | High                                                                                |

Python is a fine choice if you'd rather maintain the backend in it, but the type sharing and single toolchain make TS the better fit for a WebSocket-heavy app.

## Server

| Concern          | Pick                                                                                                    | Notes                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | **Node.js 26** (`node:26-alpine`)                                                                       | Enters LTS 2026-10-28, supported to April 2029. Node 24 LTS is the fallback if anything breaks before then.                                     |
| Language         | TypeScript (strict)                                                                                     | `tsx` for dev, `tsup` for build                                                                                                                 |
| Package manager  | pnpm workspaces                                                                                         | Monorepo: `apps/server`, `apps/web`, `packages/shared`                                                                                          |
| Meshtastic       | `@meshtastic/core`, `@meshtastic/transport-node`, `@meshtastic/transport-http`, `@meshtastic/protobufs` | Pin exact versions; check JSR/npm for the latest at kickoff. Wrap behind a `Transport` interface so a hand-rolled framer can drop in if needed. |
| HTTP server      | Fastify 5                                                                                               | Schema-first routes, fast, good plugin ecosystem                                                                                                |
| WebSocket        | `@fastify/websocket` (ws)                                                                               | Session-cookie auth on upgrade                                                                                                                  |
| Validation       | Zod + `fastify-type-provider-zod`                                                                       | Same schemas validate REST input and WS messages                                                                                                |
| Database         | SQLite (WAL) via `better-sqlite3`                                                                       | Synchronous, fast, zero-ops, single file on `/data`                                                                                             |
| ORM / migrations | Drizzle ORM + Drizzle Kit                                                                               | Typed queries, SQL-first migrations run on start                                                                                                |
| Auth             | `@fastify/session` + `@fastify/cookie`, `argon2`                                                        | Local accounts; optional trusted-proxy header mode                                                                                              |
| Security         | `@fastify/helmet` (CSP), `@fastify/rate-limit`, `@fastify/csrf-protection`                              |                                                                                                                                                 |
| Logging          | Pino (JSON to stdout)                                                                                   | Built into Fastify                                                                                                                              |
| File watching    | `chokidar`                                                                                              | Hot-reload `/data/themes`                                                                                                                       |
| Scheduling       | `croner`                                                                                                | Pruning, nightly SQLite backup                                                                                                                  |

## Client

| Concern           | Pick                                                                  | Notes                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework         | React 19 + Vite                                                       | Most predictable output from AI devs; huge ecosystem                                                                                                  |
| Routing           | TanStack Router                                                       | Type-safe routes                                                                                                                                      |
| Server state      | TanStack Query                                                        | REST caching; WS events patch the cache                                                                                                               |
| Client state      | Zustand                                                               | Connection state, UI prefs                                                                                                                            |
| UI primitives     | **Radix UI primitives (unstyled)**                                    | Accessible dialogs, menus, tabs with zero built-in styling — essential for full theme control. Avoid pre-styled kits (MUI, Mantine, shadcn defaults). |
| Styling           | Plain CSS + custom properties + `@layer`; CSS Modules for layout only | Themes override tokens in `@layer theme`; no CSS-in-JS                                                                                                |
| Icons             | Lucide (inline SVG, `currentColor`)                                   | Themes recolor freely                                                                                                                                 |
| Map               | MapLibre GL JS                                                        | Per-theme style JSON; tile URL configurable                                                                                                           |
| Charts            | uPlot                                                                 | Tiny, fast time series; colors read from CSS vars                                                                                                     |
| Virtualized lists | TanStack Virtual                                                      | Long message history and node lists                                                                                                                   |
| Dates             | `date-fns`                                                            | Relative times, local formatting                                                                                                                      |
| Notifications     | Web Notifications API + `<audio>`                                     | Theme can supply sounds                                                                                                                               |

## Theming enforcement

| Tool                   | Rule                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Stylelint              | `color-no-hex`, `function-disallowed-list: [rgb, rgba, hsl, hsla]` outside `themes/` |
| ESLint custom rule     | No literal colors/px values in `style={}` props                                      |
| Playwright screenshots | Every main screen × every built-in theme                                             |

## Testing & quality

| Layer                     | Pick                                                           |
| ------------------------- | -------------------------------------------------------------- |
| Unit / integration        | Vitest                                                         |
| Radio test double         | `FakeNode` TCP server replaying recorded `FromRadio` frames    |
| Real-protocol integration | `meshtasticd` (Linux native, simulator mode) in docker-compose |
| E2E + visual regression   | Playwright                                                     |
| Lint / format             | ESLint (typescript-eslint) + Prettier, Stylelint               |
| Type checks               | `tsc --noEmit` in CI                                           |

## Build & deploy

| Concern       | Pick                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| Container     | Multi-stage Dockerfile → `node:26-alpine`, non-root `1000:1000`, < 200 MB |
| Native module | `better-sqlite3` compiled in the build stage for each arch                |
| CI/CD         | GitHub Actions → `docker buildx` multi-arch (amd64, arm64) → GHCR         |
| Runtime       | docker-compose; works under Komodo, Portainer or plain compose            |
| Health        | `GET /healthz` with per-node connection state                             |
| Persistence   | Single `/data` volume: db, themes, backups                                |

## Things deliberately left out

- **Next.js / SSR**: no SEO or server rendering needs; a static SPA served by Fastify is simpler.
- **Postgres / Redis**: one user, one container. SQLite handles this load comfortably.
- **Tailwind**: utility classes bake visual decisions into markup, which fights drop-in CSS themes.
- **Electron/Tauri**: it's self-hosted web; a PWA manifest covers "install on phone".
- **Bun/Deno**: both work with the Meshtastic packages (there's a Deno TCP transport), but Node has the least friction with `better-sqlite3` and the Node TCP transport.

## Sources

- [Meshtastic web/JS monorepo (core + transports)](https://github.com/meshtastic/web)
- [@meshtastic/core on JSR](https://jsr.io/@meshtastic/core)
- [Meshtastic Client API (TCP framing)](https://meshtastic.org/docs/development/device/client-api/)
- [Evolving the Node.js Release Schedule](https://nodejs.org/blog/announcements/evolving-the-nodejs-release-schedule)
