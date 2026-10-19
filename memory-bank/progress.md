# MeshTerm — Progress

Updated after every phase. Newest phase at the bottom.

## Changes agreed before Phase 0 (2026-10-19)

- Clarifying questions on the plan were answered. The answers are recorded in the "Confirmed decisions" section of `implementation-plan.md` and in `DECISIONS.md`.
- Workflow: stop after every phase and report; update this file after each phase; commit only when asked.
- The user asked to start Phase 1. Phase 0 is a prerequisite, so both were done before stopping (user's choice).

## Phase 0: Repository and tooling (done 2026-10-19)

- **0.1:** `git init` (branch `main`, nothing committed). Root `package.json` (private, `engines.node >=24`), `.nvmrc` (24), `pnpm-workspace.yaml`, `.npmrc`, `.gitignore`. Packages: `@meshterm/server`, `@meshterm/web`, `@meshterm/shared`, `@meshterm/fake-node`.
  - **Environment finding:** the repo was first on G: (exFAT, no symlinks), which needed a hoisted-linker + path-alias workaround. See "Project move" below.
- **0.2:** `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2023, NodeNext), per-package `tsconfig.json`, and `pnpm typecheck`. Verified it fails on an implicit `any`.
- **0.3:** ESLint 9 flat config (typescript-eslint `strictTypeChecked`, React + hooks rules for `apps/web` only, Prettier compat) and Prettier. Verified lint fails on an unused variable. `pnpm format` also normalized whitespace and table alignment in the existing Markdown docs.
- **0.4:** Vitest 5 with root `projects` plus per-package configs; `test`, `test:unit`, `test:int`. Verified single-test (`pnpm test -t`) and per-package (`--filter`) runs.
- **0.5:** Stylelint guard. Verified `color: #fff` fails in `apps/web/src` and passes in `themes/default/`.
- **0.6:** `memory-bank/architecture.md` and `DECISIONS.md` created; the commands section was added to `CLAUDE.md`. The docs were already in `memory-bank/`.

Pinned tool versions: TypeScript 6.0.3, ESLint 9.39.5, typescript-eslint 8.71.2, Vitest 5.0.5, Vite 8.3.4, Prettier 3.9.10, Stylelint 17.16.0, Zod 4.6.7.

## Phase 1: Shared contracts (done 2026-10-19)

- **1.1:** `packages/shared/src/config.ts`: `parseConfig(env)` with defaults and `ConfigError` listing every bad field. 12 tests.
- **1.2:** `packages/shared/src/domain.ts`: `ConnectionState`, `Connection`, `MeshNode`, `Channel` (PSK stripped), `Message` (with `peer`, nullable `status`), `MessageStatus`, plus helpers. Fixtures are in `fixtures.ts`. 13 tests.
- **1.3:** `packages/shared/src/ws.ts`: `ClientMessage` (`subscribe`) and the `ServerMessage` union (`snapshot`, `connection.state`, `node.upsert`, `message.new`, `message.status`, `error`). 11 tests.

State at the end of Phase 1: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` (39 tests) are all green.

## Project move to C: (2026-10-19, between Phase 1 and Phase 2)

- The user moved the repo to `C:\Projects\MeshTerm` (NTFS). The exFAT workaround was removed: default pnpm linker, `workspace:*` deps on `@meshterm/shared` (server, web, fake-node), no tsconfig `paths` or Vitest aliases, and `@types/node` dropped from shared/web.
- Verified: a cross-package import resolves in `tsc` and Vitest. `typecheck`, `lint`, `format:check` and `test` (39) are green.

## Phase 2: FakeNode test double (done 2026-10-19)

- **2.1:** `@meshtastic/protobufs` pinned to `jsr:2.8.1` (newest; npm only has 2.8.0) plus `@bufbuild/protobuf` 2.16.0. `src/codec.ts` encodes and decodes `ToRadio`/`FromRadio`. The round-trip test for the `my_info` node number passes.
- **2.2:** `src/framing.ts` (`encodeFrame`, `StreamFramer`) and the `FakeNode` TCP server (port 0 = free port, ordered inbound log). Tests: a frame split across three writes logs one message, and garbage followed by a frame logs one message.
- **2.3:** JSON scenarios (`default`, `busy`) parsed with proto-JSON. The `want_config_id` reply follows the firmware's PhoneAPI order (a deviation from the plan's listed order; see DECISIONS) and ends with the matching `config_complete_id`. Swapping scenarios changes the node count (4 → 8).
- **2.4:** `injectText`, `injectNodeInfo` (as a `NODEINFO_APP` packet), `setAckMode` (`ack`/`nak`/`silent`, optional delay; every inbound packet also gets a `queueStatus`), `reboot(downMs)` (refused at 100 ms, accepted at 700 ms), `stop()`. One or more tests per method.
- **2.5:** `src/audit.ts` classifies the inbound log. Handshake + heartbeat = 0 transmits; adding a text packet = 1.

State at the end of Phase 2: `typecheck`, `lint`, `format:check` and `test` (68 tests; 30 in fake-node, stable over 5 repeated runs) are green.

Notes for Phase 3: the codec and framer currently live in `fake-node`. Step 3.1/3.2 should first check whether `@meshtastic/transport-node` offers a clean bytes-in, frames-out interface. If not, reuse this framer (and move it to a shared protocol module) rather than writing a second one.

## Phase 3: Transport layer (done 2026-10-19)

- **3.1:** Evaluated `@meshtastic/transport-node` 0.0.2 and `@meshtastic/core` 2.6.7 and rejected both (stale; bundle an older protobufs copy; core's framer has no >512 resync, stalls on a stray `0x94` and drops valid payloads containing `0x94 0xC3`; GPL-3.0). Moved the codec and framer into a new **`@meshterm/protocol`** package, which is now the only place protobufs are pinned and imported. Defined the `Transport` interface and the reusable `describeTransportContract` suite, plus `MockPeer`/`MockTransport`. The contract passes against the mock.
- **3.2:** `TcpTransport` with connect timeout, TCP keepalive and no-delay. New config `MESHTERM_CONNECT_TIMEOUT_MS` (10 s) and `MESHTERM_TCP_KEEPALIVE_MS` (15 s). The contract passes against FakeNode over real TCP. The framer now **drops zero-length frames** (was: decoded as empty), and a length-600 header followed by a valid frame is covered. FakeNode gained `sendFromRadio()` and `dropClients()`.
- **3.3:** `Heartbeat` (default 60 s, unchanged). With faked intervals against FakeNode: 0 before the interval, 1 after one, 3 after three, none after `disconnect()`, and it stops when the node drops the link.

State at the end of Phase 3: `typecheck`, `lint`, `format:check` and `test` (89 tests) are green; the server and fake-node suites were stable over 5 repeated runs.

Notes for Phase 4: create a new transport per connection attempt (they are single-use) and treat `close` as the failure signal. A failed `connect()` only rejects. Start `Heartbeat` on reaching `connected` and stop it on any exit.

## Phase 4: NodeConnection state machine (done 2026-10-19)

- **4.1:** `Clock`/`FakeClock` and an injectable random source. `ConnectionStateMachine` with an `ALLOWED_TRANSITIONS` table. A table-driven test covers all 11 allowed transitions (one event each) and all 14 forbidden ones (throw, no event).
- **4.2:** `NodeConnection`: a new transport per attempt, a random nonce (skips 0 and the firmware's special 69420/69421), the handshake buffered into a pending model, connected only on a _matching_ `config_complete_id`, and a config timeout (new `MESHTERM_CONFIG_TIMEOUT_MS`, 30 s) → reconnecting. Against FakeNode: the `default` scenario gives 4 nodes, channels [0, 1] and `0xa1b2c3d4`; `busy` gives 8 nodes. In "wrong id" mode it stays configuring until the timeout, then reconnects. FakeNode gained `setConfigCompleteMode`; MockPeer gained `onReceive`.
- **4.3:** ±20 % jitter backoff capped at 60 s. With random = 0.5: 2, 4, 8, 16, 32, 60, 60 s. Still retrying after 25 failures. `stop()` cancels the pending retry. The delay resets to 2 s after a successful connection. `Heartbeat` moved onto the injectable clock.
- **4.4:** `reboot-recovery.int.test.ts`: connected → `reboot(1000)` → reconnecting, (failed connecting/reconnecting while down), connecting, configuring, connected. The model is rebuilt (a node injected during the downtime shows up and `rebootCount` goes 3 → 4). The transmit audit reports 0 transmits and 2 handshakes.

State at the end of Phase 4: `typecheck`, `lint`, `format:check` and `test` (128 tests incl. 1 integration) are green; the server and fake-node suites were stable over 5 repeated runs.

Notes for Phase 5/6: `NodeConnection.model` is in-memory only for now. Per the source-of-truth decision it must become a write-through cache over SQLite (hydrate at boot, persist on handshake and updates). `fromRadio` events are the hook for the Phase 6 decoder.

## Phase 5: Database (done 2026-10-19)

- **5.1:** `better-sqlite3` 13.0.3 + `drizzle-orm` 0.45.4 (+ `drizzle-kit` 0.31.11). `openDatabase(path or :memory:)` / `openDataDirDatabase(dataDir)` create the directory and file. WAL and foreign keys verified.
- **5.2:** Schema for `connections`, `nodes`, `channels` (no PSK), `messages` (with `peer` and both indexes) and `settings`. Migration `0000_base_schema` generated with Drizzle Kit. A fresh migrate works, a second run is a no-op, and the `sqlite_master` and `index_info` checks pass. The full schema is in `architecture.md`. New command `db:generate`.
- **5.3:** `seedConnectionFromEnv`: the first start creates one row, a restart with the same env keeps one, and a changed port updates that row in place. User-added rows are left alone. `initDatabase()` = open + migrate + seed.
- **5.4:** Repositories return the shared types. Pagination uses an `(rxTime, id)` cursor because firmware times are whole seconds. 120 messages (3 per second) page as 50/50/20 with no overlap. DM lists include both directions and exclude other peers.
- **5.5:** Migration `0001_message_dedupe` adds the unique `(connection_id, from_num, packet_id)` index. A second copy reports `duplicate` and leaves one row; the same packet id from another sender inserts.

State at the end of Phase 5: `typecheck`, `lint`, `format:check` and `test` (153 tests) are green; the server suite was stable over 3 repeated runs.

Notes for Phase 6: `NodeConnection.model` still isn't backed by SQLite. Wire the handshake and updates through the repositories and hydrate at boot (source-of-truth decision). The merge rules for partial node updates (e.g. `last_heard` from any packet) go in the persistence subscriber. Phase 10's Dockerfile must copy `apps/server/drizzle/` and have build tools for `better-sqlite3`.

## Phase 6: Event hub and decoding (done 2026-10-19)

- **6.1:** `EventHub` (typed, synchronous, `subscribe` returns unsubscribe, `subscribeAll`, throwing subscribers logged and isolated) + a `Logger` interface. 5 tests.
- **6.2:** Pure `decodeFromRadio` → internal `radio.*` events (my_info, node_info, channel without PSK, text → channel message or DM, NODEINFO_APP, routing → acked/failed). Unhandled ports return no events plus a reason. `nodeHeard` gives a last-heard update for any packet. Tested on real frames recorded from FakeNode (13 tests).
- **6.3:** `attachPersistence` (writes, then publishes `node.upsert`/`channel.upsert`/`message.new`/`message.status`; duplicates publish nothing; node merge rules) and `wireConnection`. New migration `0002_connection_my_node_num`. Integration test: the handshake lands in SQLite (my node number, 4 nodes, 2 channels). An injected text is stored within 1 s. The same packet id again leaves one row and one `message.new`. The sender's `last_heard` advances.

State at the end of Phase 6: `typecheck`, `lint`, `format:check` and `test` (183 tests incl. 2 integration) are green; the server and fake-node suites were stable over 5 repeated runs.

Agreed interpretation (see DECISIONS 6.3): `NodeConnection.model` stays a handshake buffer; SQLite is what clients read. Flag it if you want boot-time hydration anyway.

Notes for Phase 7: build the WS snapshot and REST from the repositories (`getMyNodeNum` for `myNodeNum`). Forward the hub's public events (`subscribeAll`, skip `radio.*`). Outbound sends must insert the `out` message _before_ transmitting, so `findOutboundByPacketId` can match the ACK. Use Pino and pass it as the `Logger`.

## Phase 7: HTTP and WebSocket server (done 2026-10-19)

- **7.1:** `buildApp(config, deps)` (Zod type provider, Pino JSON, JSON errors), `main.ts` with SIGTERM/SIGINT, scripts `dev` (tsx watch), `build` (tsup → `dist/main.js`) and `start`. Tests: the app starts against FakeNode, and `close()` leaves FakeNode with 0 sockets. The bundle was run for real: it migrated from `dist/`, connected and served `/healthz`.
- **7.2:** `GET /healthz`: `connected` with FakeNode up, still 200 with `reconnecting` after it stops.
- **7.3:** REST reads for connections/nodes/channels/messages with Zod-validated params and queries. Both or neither of `channel`/`peer`, `limit=500`, a bad cursor or channel 9 → 400. Unknown id → JSON 404. No `psk` key at any depth.
- **7.4:** `GET /ws` + `WsGateway`: `subscribe` → one snapshot from SQLite (4 nodes); `injectText` → `message.new`; malformed JSON → `error` frame, socket stays open. Every received frame is validated against the shared `ServerMessage` schema in tests.
- **7.5:** Fan-out to all subscribers; abruptly terminating one client mid-stream doesn't affect the other; `reboot()` gives both clients `connection.state` reconnecting → … → connected.
- **7.6:** `POST /api/connections/:id/messages` + `MessageSender`. Integration tests: ack → `queued, sent, acked`; nak → `failed`; silent with a 300 ms timeout → `failed`; 300-byte/202-byte/blank/ambiguous bodies → 400; node down → 409 and the node receives nothing.
- **7.7:** `@fastify/rate-limit` on the send route: 10/min per IP; the 11th request → 429 `rate_limited`, and reads are unaffected.
- **7.8:** No-transmit integration test: idle + one restart → 0 transmits, 0 other, 2 handshakes, only heartbeats otherwise.

State at the end of Phase 7: `typecheck`, `lint`, `format:check`, `test` (213 tests) and `build` are green; the server and fake-node suites were stable over 5 repeated runs.

Notes for Phase 8: the server must also serve the SPA (8.2) without swallowing `/api/*` or `/ws`. The JSON 404 handler already covers unknown `/api` paths. The web client should treat `message.new` (queued) + `message.status` as the outgoing lifecycle.

## Phase 8: Web foundation (done 2026-10-19)

- **8.1:** Vite + React 19 + TS, Vitest (jsdom 29) + Testing Library, scripts `dev`/`build`/`preview`; root `pnpm dev` and `pnpm dev:fake` (adds a standalone FakeNode CLI); `.env.example`. Verified `/api/connections` and `/healthz` load through the Vite proxy with `dev:fake`. That needed a free port, because 127.0.0.1:8080 and :5173 are taken by other software on this machine, so Vite now reads `MESHTERM_HTTP_PORT` from `.env`.
- **8.2:** `@fastify/static` serves `apps/web/dist` and `themes/`. SPA fallback for client routes; `/api/*`, `/ws`, `/healthz`, `/themes/` and dotted paths never fall back; hashed assets immutable, `index.html` no-cache. Also verified with the real bundle (auto-detected both folders).
- **8.3:** Layer order declared once inline in `index.html`; reset/tokens/base CSS (colors fall back to system colors); `themes/default/theme.json` + `theme.css` (light + dark). Playwright: body's `--mt-surface-bg` = Default value (and it paints); a test-only theme in `@layer theme` with no `!important` overrides it; a later `@layer base` rule can't.
- **8.4:** `eslint/theming-rules.js` (literal colors, px and numeric lengths banned in `style={}`); `style={{ color: "#fff" }}` fails `pnpm lint`; unit test with 11 rejected and 10 allowed snippets. `expectDataMt`/`byDataMt` helpers; hook list started in `architecture.md`.
- **8.5:** Shell (header + status-pill placeholder, sidebar/tab-bar nav, main) with TanStack Router routes `/channels/$index`, `/nodes`, `/dm/$nodeNum`, `/` → `/channels/0`, not-found. Playwright at 390 and 1280 px: right nav visible, no horizontal scroll, every route renders, nav links navigate.

State at the end of Phase 8: `typecheck`, `lint` (TS + CSS), `format:check`, `test` (262 unit/integration tests), `test:e2e` (20 Playwright tests) and both builds are green.

Notes for Phase 9: replace the `StatusPill` placeholder (keep `data-mt="status-pill"`; states = connection states). Use `expectDataMt` in every component test. Playwright runs against `e2e/serve.ts`, and FakeNode there can be driven for live-data tests if needed (it is in-process).

## Phase 9: Web live data (done 2026-10-19)

- **9.1:** `LiveSocket` + Zustand store. Tests against a local `ws` server: subscribes on open; after the server kills the socket it reconnects and subscribes again; invalid frames are dropped without throwing; stop() stops retrying; keeps retrying while the server is down.
- **9.2:** TanStack Query cache: snapshot seeding, `node.upsert` / `message.new` (dedupe, ordered) / `message.status` (unknown id = same object) / `connection.state`, on a real `QueryClient`. `messageCursor` and `SNAPSHOT_MESSAGES` moved to shared.
- **9.3:** Status pill with every state's `data-mt-state` and label, plus a separate socket indicator. Playwright: after `reboot(3000)` the pill shows `reconnecting`, then `connected`. Added the e2e FakeNode control API.
- **9.4:** Channel tabs from the scenario (2 tabs). Clicking the second routes to `/channels/1` and moves the active state.
- **9.5:** Virtualized message list: 5,000 messages → fewer than 100 rendered; scrolling to the top fetches exactly one older page with the right `before`; outbound status shown and updated live.
- **9.6:** Composer: emoji byte count (👋🏽 = 8), disabled states, Enter sends once, Shift+Enter newline, 409/429 errors. Playwright: "hello" appears and reaches `acked`, and FakeNode received exactly one text transmit.
- **9.7:** Node table: 4 scenario nodes, newest-heard first, self highlighted. `node.upsert` updates the row in place, and every row keeps its DOM element (also when re-sorted).
- **9.8:** DMs: row → `/dm/:num`. Playwright: the sent DM reaches FakeNode with `to` = Ridge; an injected DM from Ridge appears in the open conversation and not in channel 0.

State at the end of Phase 9: `typecheck`, `lint` (TS + CSS), `format:check`, `test` (304 unit/integration tests), `test:e2e` (32 Playwright tests, run twice) and both builds are green.

Notes for Phase 10: the Docker image must keep the layout `apps/server/dist`, `apps/server/drizzle`, `apps/web/dist`, `themes/` (the server auto-detects them), plus production `node_modules` for the server (better-sqlite3 needs build tools in the build stage).

## Repository (2026-10-19, after Phase 9)

- The user created https://github.com/fireshaper/MeshTerm. Phases 0–9 were committed as one commit (`6cb902e`), plus `.gitattributes` pinning LF (`3f884fe`, because `core.autocrlf=true` would otherwise give CRLF checkouts that fail Prettier). Pushed to `origin/main`.
- Effect on Phase 10: the CI workflow's "passes in Actions" test (10.3) is no longer deferred, and the compose image can be `ghcr.io/fireshaper/meshterm`.

## Phase 10: Packaging (done 2026-10-19)

- **10.1:** Multi-stage `Dockerfile` (build → runtime on node:26-alpine). Verified locally: the build succeeds; the image is **163 MB uncompressed / ~66 MB compressed**; with a FakeNode container it is `healthy` after 5 s; `id -u` = 1000; `/data/meshterm.db` is on the mounted volume; `docker stop` → exit 0. Reaching < 200 MB meant bundling every JS dependency into `dist/main.js` and shipping only a trimmed `better-sqlite3`. An unwritable `/data` now fails with a fix-it message.
- **10.2:** `docker-compose.yml`, `README.md` (trusted-networks warning at the top), `compose.test.yml` (FakeNode service via the `fake-node` Dockerfile target). The FakeNode CLI gained `serve`/`inject` and a control API (shared with the e2e harness). Verified on host port 18080: the UI shows **Connected**; a message injected with the CLI is still in channel 0 (API and UI) after `docker compose restart meshterm`.
- **10.3:** `.github/workflows/ci.yml` (checks, e2e, docker). In Actions: `main` at `082f903` was **green** in all three jobs (run 39297585292). A temporary branch `ci/red-check` with one deliberately failing unit test turned the run **red at the "Unit tests" step**, with the other jobs green (run 39297989818). The branch was then deleted.

State at the end of Phase 10: everything is green locally and in GitHub Actions. Phase 10 code is committed and pushed (`082f903`); this progress note is not committed yet.

Notes for Phase 11: the gate test can use `compose.test.yml` (or `e2e/serve.ts`) plus the FakeNode control API. Publishing images to GHCR (multi-arch) is not set up yet; the CI docker job only builds amd64.

## Phase 11: Base-app gate (done 2026-10-19)

- **11.1:** `e2e/gate.spec.ts`: two browser contexts on channel 0. A sends and both see `acked`; a mesh message shows in both; `reboot(5000)` takes both pills to `reconnecting` → `connected` without a reload; B sends after recovery; then a **real restart of the server process** (the built bundle) and a reload of both pages, after which all three messages are still shown. The transmit audit shows exactly 2 text transmits, 0 other. Passed **3/3** locally with `pnpm test:gate`. CI now runs it three times in a row.
- **11.2:** Visual baselines for channel view, node list and DM view at 1280 and 390 px (Default theme), win32 and linux (the latter generated in the Playwright image, and stable on a rerun). The baselines exposed a bug, now fixed: own-node SNR showed "0 dB". better-sqlite3 now uses its prebuilds everywhere (no compiler; Dockerfile simplified, image still 163 MB). Docs closed out: `architecture.md`, `DECISIONS.md`, `CLAUDE.md` (status, commands, visual-baseline workflow).

State: `typecheck`, `lint`, `format:check`, `test` (307), `test:e2e` (39 Playwright incl. gate and visuals) and `test:gate` (3/3) are green locally.

CI (GitHub Actions run 39305074455, commit `ab435d4`): all three jobs green. Inside the Playwright image, the full e2e suite passed including the Linux visual baselines, and the gate passed **three runs in a row**. The fresh-clone check passed: a clean tree, following CLAUDE.md alone, installed, passed `pnpm test` (307), and ran `compose.test.yml` with FakeNode to `healthy`/`connected`.

**The base app is done** (the implementation plan's Phase 11 gate). Next work is the "Out of scope" list in `implementation-plan.md`, to be planned separately.

## Open items

- The user will confirm their node's firmware version and whether LAN smoke tests are possible.
