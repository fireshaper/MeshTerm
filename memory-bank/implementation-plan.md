# MeshTerm — Implementation Plan (Base App)

Step-by-step build instructions for AI developers. The plan covers the **base app** only: one Meshtastic node over TCP, channel and direct messaging, persistent history, live sync across browsers, the theming foundation and a working container. Everything else is listed under [Out of scope](#out-of-scope) and will be planned later.

## How to use this plan

- Do the steps **in order**. Each one builds on the ones before it.
- A step is done only when its **Test** passes and `typecheck`, `lint` and the existing tests are still green.
- Finish one step before starting the next. Don't bundle steps together.
- When something is ambiguous, pick the simplest reasonable option and record it in `DECISIONS.md`. Include the step number, the choice and why. Then keep going.
- Follow the rules in `CLAUDE.md` at all times, especially: tokens only for styling, `data-mt` hooks on components, server is the only radio client, and **never transmit on the mesh** beyond the config handshake and heartbeats.
- After each phase, update `memory-bank/architecture.md` with the files you added, what they're responsible for, and any schema changes.

- **Stop at the end of every phase.** Update `memory-bank/progress.md` with what was done and any changes agreed between phases, then report to the user. Commit only when the user asks.

### Confirmed decisions (2026-10-19)

These override anything below that conflicts with them. Copy them into `DECISIONS.md` in Step 0.6.

1. **Own the protocol logic.** Don't use `MeshDevice` from `@meshtastic/core`, because it transmits on its own schedule. Use `@meshtastic/protobufs` for types and encode/decode. Use `@meshtastic/transport-node` only if it offers a clean bytes-in, `FromRadio`-frames-out interface with no `MeshDevice` assumptions. Otherwise write the framer ourselves. The handshake, heartbeat and ACK matching are all ours.
2. **Registries.** Prefer npm when the same version is published there, and use JSR (`jsr:` specifiers) otherwise. Pin exact versions either way.
3. **Protobufs version.** Pin the newest release. The user will confirm their node's firmware version later. FakeNode is the only radio for now. Capture fixtures from a real node once one is available.
4. **Source of truth.** SQLite is authoritative. The in-memory model in `NodeConnection` is a write-through cache hydrated from SQLite at boot, and it must never hold anything SQLite doesn't. The WS `snapshot` is built from SQLite.
5. **`peer` column.** `messages.peer` is stored: `to_num` for outgoing DMs, `from_num` for incoming DMs, and NULL for broadcasts. Add indexes `(connection_id, peer, rx_time)` and `(connection_id, channel_index, rx_time)`.
6. **Message IDs.** `id` is a UUID. Outbound `packet_id` is a server-generated random non-zero uint32. Inbound messages store the sender's `packet_id`. Add a unique index on `(connection_id, from_num, packet_id)` so rebroadcast duplicates dedupe at insert.
7. **Text limit.** 200 UTF-8 bytes, counted with `new TextEncoder().encode(s).length`, on both server and client.
8. **Breakpoints.** Bottom tab bar below 768 px and sidebar at 768 px and up. The three-pane layout at 1200 px and up comes later. Tests use 390 px and 1280 px.
9. **Themes location.** Repo-root `themes/default/`, bundled into the image. `/data/themes` and hot reload come later.
10. **Node version.** `engines.node` is `>=24` and `.nvmrc` is `24`. The Docker runtime is `node:26-alpine`.
11. **No GitHub repo yet.** Write the CI workflow in Step 10.3, but its "workflow passes" test is deferred until a remote exists. The image owner in compose stays a placeholder.

**Base-app done condition (the gate in Phase 11):** two browsers stay in sync while chatting through a node. The app recovers on its own from a node reboot. History survives a container restart.

---

## Phase 0 — Repository and tooling

### Step 0.1 — Create the pnpm workspace

- Initialize a git repo and a root `package.json` marked private, with `engines.node` set to `>=24`.
- Add `.nvmrc` with `24` and a `pnpm-workspace.yaml` that includes `apps/*` and `packages/*`.
- Create empty packages `apps/server`, `apps/web`, `packages/shared` and `packages/fake-node`, each with its own `package.json` and a scoped name (`@meshterm/server` and so on).
- Add a `.gitignore` covering `node_modules`, build output, `.env`, local `data/` and Playwright reports.

**Test:** `pnpm install` succeeds from a clean clone. `pnpm -r exec node -e "console.log(process.cwd())"` prints all four package directories.

### Step 0.2 — TypeScript strict configuration

- Add a root `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2023 target and module resolution suitable for Node ESM.
- Give each package a `tsconfig.json` that extends the base. Use TypeScript project references so `apps/*` can import `packages/shared`.
- Add a root `typecheck` script that runs `tsc --noEmit` across all packages.

**Test:** `pnpm typecheck` passes. Temporarily add a file with an implicit `any` parameter and confirm `pnpm typecheck` fails, then remove it.

### Step 0.3 — ESLint and Prettier

- Configure ESLint (flat config) with typescript-eslint type-aware rules and React rules for `apps/web` only. Add Prettier and `eslint-config-prettier`.
- Add root scripts `lint`, `format` and `format:check`.

**Test:** `pnpm lint` and `pnpm format:check` pass. Add an unused variable and confirm `pnpm lint` fails, then remove it.

### Step 0.4 — Vitest

- Add Vitest to every package, with a root `test` script that runs all of them.
- Use a naming split: unit tests are `*.test.ts` and integration tests are `*.int.test.ts`. Add root `test:unit` and `test:int` scripts.
- Add one trivial passing test per package.

**Test:** `pnpm test` runs four passing tests. `pnpm test -- -t "<name of one test>"` runs only that test. `pnpm --filter @meshterm/server test` runs only the server's tests.

### Step 0.5 — Stylelint theming guard

- Add Stylelint for all `.css` files.
- Outside any `themes/` directory, ban hex colors and the `rgb`, `rgba`, `hsl` and `hsla` functions. Inside `themes/**`, allow them.
- Add a root `lint:css` script and make it part of `lint`.

**Test:** a CSS file in `apps/web/src` containing `color: #fff` fails `pnpm lint:css`. The same rule in `themes/default/theme.css` passes.

### Step 0.6 — Project memory files

- Create `memory-bank/architecture.md` with the headings "Packages", "Server modules", "Web modules", "Database schema" and "WebSocket protocol", each marked as not yet built.
- Create `DECISIONS.md` at the repo root with a short format guide: step, decision, reason.
- `app-design-document.md` and `tech-stack.md` are already in `memory-bank/`, and the links in `CLAUDE.md` already point there. Check that they still resolve.
- Copy the "Confirmed decisions" above into `DECISIONS.md`.
- Add the commands from steps 0.2–0.5 to the commands section of `CLAUDE.md`.

**Test:** every file path referenced in `CLAUDE.md` exists. Every command listed in `CLAUDE.md` runs successfully.

---

## Phase 1 — Shared contracts (`packages/shared`)

### Step 1.1 — Runtime configuration schema

- Define a Zod schema for server configuration read from environment variables:
  - `MESHTERM_NODE_HOST` (required for now)
  - `MESHTERM_NODE_PORT` (default 4403)
  - `MESHTERM_HTTP_PORT` (default 8080)
  - `MESHTERM_DATA_DIR` (default `/data`)
  - `MESHTERM_LOG_LEVEL` (default `info`)
  - Tuning values used later: heartbeat interval, ACK timeout, backoff minimum (2 s) and maximum (60 s).
- Export a function that parses an env-like object and returns a typed config, or throws an error listing every invalid field.

**Test:** unit tests cover defaults when only the host is given, port 0 and port 70000 rejected, a non-numeric port rejected, and an error message naming each bad field.

### Step 1.2 — Domain schemas

- Define Zod schemas and inferred types for:
  - `ConnectionState`: `disconnected`, `connecting`, `configuring`, `connected`, `reconnecting`
  - `Connection`: id, name, host, port, transport (only `tcp` for now), enabled
  - `MeshNode`: node number, hex ID string, long name, short name, hardware model, role, last heard, SNR, hops away
  - `Channel`: index 0–7, name, role. The schema has **no** PSK field.
  - `Message`: id (UUID), connection id, packet id, from, to, peer (nullable), channel index, text, rx time, direction (in/out), status, RX SNR and RSSI
  - `MessageStatus`: `queued`, `sent`, `acked`, `failed`
- Every type that carries persisted data includes `connectionId`.

**Test:** unit tests confirm that a valid fixture of each type parses. An invalid status is rejected. A channel index of 8 is rejected. A `Channel` object with an extra `psk` key has that key stripped by parsing.

### Step 1.3 — WebSocket protocol schemas

- Define the client-to-server message: `subscribe` with a connection id.
- Define server-to-client messages as a discriminated union on `type`:
  - `snapshot`: connection state, my node number, nodes, channels, and recent messages per channel and per DM peer
  - `connection.state`
  - `node.upsert`
  - `message.new`
  - `message.status`
  - `error`
- Leave the other event types from the design doc for later phases.

**Test:** unit tests round-trip every message type through JSON and parse it back unchanged. An unknown `type` is rejected. A `message.status` event with a missing message id is rejected.

---

## Phase 2 — FakeNode test double (`packages/fake-node`)

Build this before the real transport so every later step can be tested without a radio.

### Step 2.1 — Protobuf dependency

- Add `@meshtastic/protobufs` at an **exact** pinned version and record the version in `DECISIONS.md`.
- Add a small helper module that encodes and decodes `ToRadio` and `FromRadio` using the package. Don't hand-write protobuf definitions.

**Test:** a unit test encodes a `FromRadio` containing `my_info` with a known node number, decodes it, and gets the same node number back.

### Step 2.2 — FakeNode TCP server with real framing

- Create a `FakeNode` class that listens on a configurable port. Port 0 means pick a free one, and the chosen port is exposed.
- Outbound frames use the stream header `0x94 0xC3` followed by a 2-byte big-endian length.
- Inbound bytes go through a framer that handles partial frames, multiple frames per chunk, garbage bytes before the magic, and resync when the length is over 512.
- Store every decoded inbound `ToRadio` in an ordered log that tests can read and clear.

**Test:** a raw `net` socket sends one framed `ToRadio`, split awkwardly across three writes, and FakeNode logs exactly one decoded message. Sending garbage bytes and then a valid frame also produces exactly one logged message.

### Step 2.3 — Config handshake fixture

- When FakeNode receives `want_config_id = N`, it replies with this sequence: `my_info`, a `node_info` for itself, `node_info` for at least three other nodes, its device metadata, channels 0 (primary) and 1 (secondary), the config sections it has, and finally `config_complete_id = N`.
- Load the reply content from a JSON fixture file (a "scenario") so tests can swap in a different mesh.

**Test:** a raw socket client sends `want_config_id = 42` and receives the sequence in order. The last message is `config_complete_id = 42`. Running with a second scenario changes the node count.

### Step 2.4 — Scriptable control API

Add methods that tests can call:

- `injectText(from, channel or to, text)`: sends a `FromRadio` packet with a `TEXT_MESSAGE_APP` payload, a unique packet id, and RX SNR/RSSI values.
- `injectNodeInfo(node)`
- `setAckMode("ack" | "nak" | "silent")`: controls how FakeNode answers any outgoing text it receives. It sends a routing ACK, a routing error, or nothing, always referencing the request id.
- `reboot(downMs)`: closes all client sockets, refuses new connections for `downMs`, then accepts again.
- `stop()`

**Test:** one unit test per method using a raw client. For example, with ack mode set to `ack`, a sent text produces a routing packet whose request id matches the sent packet id. After `reboot(500)`, a connection attempt at 100 ms fails and one at 700 ms succeeds.

### Step 2.5 — Transmit audit helper

- Add a helper that classifies the inbound log into "handshake", "heartbeat" and "transmit" (anything that would go out over the mesh, such as a mesh packet).

**Test:** after a raw client sends one `want_config_id` and one heartbeat, the classifier reports zero transmits. After it sends a text packet, the classifier reports one transmit.

---

## Phase 3 — Transport layer (`apps/server`)

### Step 3.1 — Transport interface and contract tests

- Look at `@meshtastic/transport-node` and `@meshtastic/core` (pinned exact versions). Decide whether to use them directly or wrap them, and record the decision.
- Define a `Transport` interface in the server with these methods and events:
  - `connect()` and `disconnect()`
  - `send(ToRadio)`
  - events for a received `FromRadio`, `open`, `close` (with a reason) and `error`
- Write a reusable **contract test suite** that takes a transport factory and checks: connect then open, receive a decoded `FromRadio`, send arrives at the peer, peer close triggers `close`, and `disconnect()` closes cleanly with no further events.

**Test:** the contract suite passes against an in-memory mock transport written for this purpose.

### Step 3.2 — TCP transport

- Implement the TCP transport behind the interface, using the official package if step 3.1 chose it.
- If you need your own framer, reuse the rules from step 2.2: magic header, a 512-byte maximum and resync. Share it from a common module rather than copying it.
- Set TCP keepalive and a connect timeout from config.

**Test:** the step 3.1 contract suite passes against FakeNode. Framing unit tests cover: one frame split across chunks, two frames in one chunk, garbage prefix, a length of 600 followed by a valid frame (the valid frame is still delivered), and a zero-length frame ignored.

### Step 3.3 — Heartbeat

- Once connected, send a `heartbeat` `ToRadio` at the configured interval and stop when disconnected. Record the default interval and your reasoning in `DECISIONS.md`.

**Test:** with fake timers against FakeNode, no heartbeat arrives before the interval. Exactly one arrives after one interval and three after three. None arrive after `disconnect()`.

---

## Phase 4 — NodeConnection state machine

### Step 4.1 — State machine core

- Create `NodeConnection`. It takes a connection record, a transport factory, a clock and a random source, so all of them can be faked in tests.
- Allowed transitions:
  - `disconnected → connecting → configuring → connected`
  - any active state `→ reconnecting` on failure
  - `reconnecting → connecting`
  - any state `→ disconnected` on explicit stop
- Emit a state-change event with the old state, the new state and a reason.

**Test:** a table-driven unit test covers every allowed transition. Calling an internal transition that isn't allowed throws. Every transition emits exactly one event.

### Step 4.2 — Config handshake

- On transport open, generate a random `want_config_id`, send it and enter `configuring`.
- Buffer the config stream into an in-memory model: my node number, nodes and channels.
- On a `config_complete_id` that **matches**, enter `connected`. Ignore one that doesn't match.
- If no match arrives within a configurable timeout, go to `reconnecting`.

**Test:** against FakeNode, the connection reaches `connected` and its model has the scenario's node count, channels and my node number. With a FakeNode variant that answers with the wrong id, it stays `configuring` and then moves to `reconnecting` after the timeout (fake timers).

### Step 4.3 — Reconnect with backoff

- On any close or error, go to `reconnecting`. Delays start at 2 s and double up to a 60 s cap, with jitter of a fraction you choose and record.
- Reset the delay after reaching `connected`. Never give up.
- An explicit stop cancels any pending retry.

**Test:** with fake timers and a fixed random source, the delays follow the expected sequence and are capped at 60 s. After 25 consecutive failures it's still retrying. Calling stop during a wait prevents further connect attempts. After one success and then a failure, the next delay is back to 2 s.

### Step 4.4 — Recovery from a node reboot (integration)

- Wire everything together against a real FakeNode with short backoff values in the test config.

**Test (`*.int.test.ts`):** connect until `connected`, then call `FakeNode.reboot(1000)`. The observed states are `reconnecting`, then `connecting`, `configuring` and `connected` again. The model is rebuilt from the new handshake. The transmit audit (step 2.5) reports zero transmits.

---

## Phase 5 — Database

### Step 5.1 — SQLite setup

- Add `better-sqlite3` and Drizzle ORM. Open `<DATA_DIR>/meshterm.db`, creating the directory if it's missing. Enable WAL mode and foreign keys.
- Expose a factory that accepts a path or `:memory:` for tests.

**Test:** starting with a temp data directory creates the file. `PRAGMA journal_mode` returns `wal`. `PRAGMA foreign_keys` returns 1.

### Step 5.2 — Base schema and migrations

- Define Drizzle tables for the base app only:
  - `connections`: id, name, host, port, transport, enabled, created at
  - `nodes`: connection id, node number, long name, short name, hardware model, role, last heard, SNR, hops away, favorite. Primary key is connection id plus node number.
  - `channels`: connection id, index, name, role. **Don't store the PSK.**
  - `messages`: `id` (UUID), `connection_id`, `packet_id`, `from_num`, `to_num`, `peer` (to_num for outgoing DMs, from_num for incoming DMs, NULL for broadcasts), `channel_index`, `text`, `rx_time`, `direction`, `status`, `rx_snr`, `rx_rssi`. Indexes on `(connection_id, channel_index, rx_time)` and `(connection_id, peer, rx_time)`.
  - `settings`: key/value
- Generate SQL migrations with Drizzle Kit and run them automatically on server start.
- Document the full schema in `memory-bank/architecture.md`.

**Test:** a fresh database migrates successfully. Running the migrations a second time does nothing and doesn't fail. A test that checks `sqlite_master` confirms every table and index exists.

### Step 5.3 — Seed connection from environment

- On start, if `connections` is empty, insert one row from `MESHTERM_NODE_HOST` and `MESHTERM_NODE_PORT`. Record what happens when the environment changes on a later start (recommended: update host and port on the single env-seeded row).

**Test:** the first start creates one row. A restart with the same environment still has one row. A restart with a changed port updates that row instead of adding a second.

### Step 5.4 — Repositories

- Create repository functions:
  - upsert node and list nodes by connection
  - upsert channel and list channels by connection
  - insert message, update message status, and get a message by id
  - list channel messages and list DM messages with a peer, both newest first, with a `before` timestamp cursor and a limit (maximum 200)
- Return the shared types from Phase 1.

**Test:** unit tests against `:memory:` cover each function. Pagination with a limit of 50 over 120 messages returns 50, then 50, then 20 with no overlap. DM listing includes both directions of a conversation and excludes other peers.

### Step 5.5 — Inbound deduplication

- Add a unique index on `(connection_id, from_num, packet_id)`. On conflict, inserting an inbound message is a no-op that reports "duplicate".

**Test:** inserting the same inbound packet twice leaves one row, and the second call reports a duplicate. The same packet id from a different sender inserts normally.

---

## Phase 6 — Event hub and decoding

### Step 6.1 — Typed event hub

- Create an in-process event hub with typed events. Use the server-to-client event types from step 1.3, plus internal events where needed.
- Subscribing returns an unsubscribe function. A subscriber that throws is logged and doesn't stop delivery to the others.

**Test:** two subscribers both receive an event. After unsubscribing, one stops receiving. A subscriber that throws doesn't prevent the other from receiving.

### Step 6.2 — FromRadio decoder

- Write a pure function that turns a decoded `FromRadio` into zero or more domain events:
  - node info becomes `node.upsert`
  - a channel becomes a channel upsert
  - a `TEXT_MESSAGE_APP` packet becomes `message.new` (inbound). Use `to` and the broadcast address to tell a DM from a channel message.
  - a routing packet with a request id becomes `message.status` (`acked`, or `failed` on error)
- Ignore every other port number and log it at debug level.

**Test:** unit tests use recorded fixtures from FakeNode for each case. A packet from an unhandled port number yields no events. A DM to my node is classified as a DM and a broadcast as a channel message.

### Step 6.3 — Persistence wiring

- Connect the pipeline: transport, NodeConnection, decoder, event hub, then a persistence subscriber that writes to the repositories.
- Duplicate inbound messages must **not** be re-emitted as `message.new`.
- Any packet from a node updates that node's `last_heard`.

**Test (`*.int.test.ts`):** after FakeNode `injectText`, a row exists in `messages` within one second. Injecting the same packet id again leaves one row and emits one `message.new`. That node's `last_heard` advanced.

---

## Phase 7 — HTTP and WebSocket server

### Step 7.1 — Fastify app factory

- Create a `buildApp(config, deps)` factory that tests can use without opening a port.
- Use Pino JSON logging and register Zod type providers.
- `close()` stops NodeConnections and closes the database. Hook SIGTERM and SIGINT in the real entry point.
- Add a `dev` script using `tsx watch` and a `build` script using `tsup`.

**Test:** `buildApp` with an in-memory database and FakeNode starts. `close()` resolves, and FakeNode then sees zero open sockets. `pnpm --filter @meshterm/server build` produces a runnable bundle.

### Step 7.2 — Health endpoint

- `GET /healthz` always returns 200 when the process is up. The body lists each connection's id and state.

**Test:** with FakeNode up, the state is `connected`. After `FakeNode.stop()`, it still returns 200 with state `reconnecting`.

### Step 7.3 — REST read endpoints

- Add these endpoints, all with Zod-validated params and queries:
  - `GET /api/connections`
  - `GET /api/connections/:id/nodes`
  - `GET /api/connections/:id/channels`
  - `GET /api/connections/:id/messages` with either `channel` or `peer`, plus `before` and `limit`
- An unknown connection id returns 404. Errors are JSON.

**Test:** `app.inject` tests cover each endpoint. A request with both `channel` and `peer` returns 400. `limit=500` returns 400. A channels response contains no key matching `psk` at any depth.

### Step 7.4 — WebSocket subscribe and snapshot

- Add `GET /ws` using `@fastify/websocket`. Validate incoming messages with the step 1.3 schemas, and answer an invalid message with an `error` frame instead of crashing.
- On `subscribe`, send one `snapshot`, then forward live hub events for that connection.

**Test:** a test WS client subscribes and receives a `snapshot` whose node count matches the FakeNode scenario. After `injectText`, it receives `message.new`. Sending malformed JSON returns an `error` frame and the socket stays open.

### Step 7.5 — Fan-out and connection-state broadcast

- Broadcast every event to all subscribed sockets. A closed or erroring socket is removed without affecting the others.
- Forward NodeConnection state changes as `connection.state`.

**Test:** two WS clients both receive the same `message.new`. Closing one abruptly, mid-stream, doesn't stop the other from receiving the next event. `FakeNode.reboot()` produces `connection.state` events in both clients.

### Step 7.6 — Send message endpoint and status tracking

- Add `POST /api/connections/:id/messages` with `text` and either `channel` or `to`.
- Reject empty text, and text over 200 UTF-8 bytes (`new TextEncoder().encode(s).length`).
- Generate a random non-zero uint32 `packet_id` before inserting.
- If the connection isn't `connected`, return 409.
- Otherwise insert the message as `queued` and emit `message.new`, then send through the transport.
- Status changes:
  - a successful write → `sent`
  - a routing ACK → `acked`
  - a routing error, or no ACK within the configured timeout → `failed`
- Emit `message.status` on each change.

**Test (`*.int.test.ts`, one per FakeNode ack mode):**

- `ack`: the WS client sees `queued`, `sent`, `acked`.
- `nak`: the WS client sees `failed`.
- `silent`: with a short timeout, the WS client sees `failed`.
- A 300-byte text returns 400.
- Sending while FakeNode is down returns 409, and FakeNode receives nothing.

### Step 7.7 — Send rate limit

- Apply `@fastify/rate-limit` to the send endpoint only. Record the limit you pick.

**Test:** sending one more request than the limit within the window returns 429, and read endpoints are unaffected.

### Step 7.8 — No-transmit guarantee

**Test (`*.int.test.ts`):** start the full app against FakeNode and stay idle for several heartbeat intervals (fake timers or short config). Restart it once. The transmit audit reports zero transmits, and the only inbound traffic is handshakes and heartbeats.

---

## Phase 8 — Web foundation (`apps/web`)

### Step 8.1 — Vite React app

- Scaffold React 19 + Vite + TypeScript. Configure the dev server to proxy `/api` and `/ws` to the server's dev port.
- Add Vitest with jsdom and Testing Library.
- Add scripts `dev`, `build` and `preview`, and a root `dev` that runs the server and web dev servers together.

**Test:** a Testing Library smoke test renders `<App />` without errors. `pnpm --filter @meshterm/web build` succeeds. With `pnpm dev` running against FakeNode, `/api/connections` loads through the proxy.

### Step 8.2 — Server serves the SPA

- In production, Fastify serves the built web assets. Unknown non-API GET paths fall back to `index.html`. `/api/*` and `/ws` are never swallowed by the fallback.

**Test:** `app.inject` confirms `GET /` and `GET /channels/0` return `index.html`. `GET /api/does-not-exist` returns a JSON 404. A hashed asset is served with a long cache header and `index.html` with no-cache.

### Step 8.3 — CSS layers and base tokens

- Declare the layer order once at the top of the global CSS: reset, base, theme, then overrides.
- In `@layer base`, define the base-app `--mt-*` tokens: surface, text, accent and status, message bubbles (in/out), typography, shape (radius and border) and motion. Base CSS must use **only** these tokens.
- Create `themes/default/theme.json` (id, name, author, version, colorScheme) and `themes/default/theme.css` in `@layer theme` with light and dark values. Serve `/themes/default/theme.css` and link it from `index.html`. The full loader and theme picker come later.

**Test:** `pnpm lint:css` passes. In a Playwright test, the computed `--mt-surface-bg` on `body` equals the Default theme value. A test-only theme file that overrides one token inside `@layer theme`, with no `!important`, changes that computed value.

### Step 8.4 — Theming hooks guard

- Add an ESLint rule (`no-restricted-syntax` or a small custom rule) that bans literal colors and px values in JSX `style` props.
- Agree on the `data-mt` convention: each component's root element gets `data-mt="<component>"`, with `data-mt-state` and `data-mt-variant` where they apply. Start a list of hooks in `memory-bank/architecture.md`.

**Test:** `style={{ color: "#fff" }}` in a component fails `pnpm lint`. A component test helper asserts that a rendered component has its expected `data-mt` attribute. Use it in every later component test.

### Step 8.5 — App shell and responsive layout

- Build the shell:
  - a header containing a status-pill placeholder
  - navigation for "Channels" and "Nodes"
  - a main content area
- Below 768 px, the navigation is a bottom tab bar (`data-mt="tab-bar"`). At 768 px and above, it's a sidebar (`data-mt="sidebar"`). Use TanStack Router routes `/channels/:index`, `/nodes` and `/dm/:nodeNum`.

**Test:** Playwright at 390 px wide shows the tab bar and no sidebar. At 1280 px it shows the sidebar and no tab bar. Neither width has horizontal page scroll. Navigating to each route renders its placeholder.

---

## Phase 9 — Web live data

### Step 9.1 — WebSocket client

- Write a WS client module that connects, sends `subscribe` for the active connection, and validates every incoming frame with the shared schemas. Drop and log invalid frames.
- Reconnect with backoff. After reconnecting, re-subscribe, and treat the new snapshot as the source of truth.
- Expose the socket status in a Zustand store.

**Test:** a unit test runs against a local `ws` test server. The client subscribes on open. After the server kills the socket, the client reconnects and subscribes again. An invalid frame doesn't throw.

### Step 9.2 — Query cache integration

- Set up TanStack Query. A `snapshot` seeds the cache for connection, nodes, channels and messages.
- Deltas patch the cache in place:
  - `node.upsert` replaces or adds one node
  - `message.new` appends to the right channel or DM list without duplicates
  - `message.status` updates one message
  - `connection.state` updates the store

**Test:** unit tests apply a sequence of events to a real `QueryClient` and check its contents. Applying the same `message.new` twice leaves one copy. A status update on an unknown message id is a no-op.

### Step 9.3 — Connection status pill

- Show the node connection state, with a separate indicator when the browser's own WS is offline. Use `data-mt="status-pill"` and `data-mt-state="<state>"`, and show the state's name in text. Don't rely on color alone.

**Test:** a component test renders each state with the correct `data-mt-state` and label. Playwright: after `FakeNode.reboot(3000)`, the pill shows `reconnecting` and then `connected`.

### Step 9.4 — Channel tabs

- Render tabs for the channels in the snapshot, skipping disabled ones. The tab for the current route has `data-mt-state="active"`, and switching tabs changes the route.

**Test:** a component test using the FakeNode scenario renders 2 tabs. Clicking the second tab sets the route to `/channels/1` and moves the active state.

### Step 9.5 — Message list

- Render the active channel's or DM's messages with TanStack Virtual, oldest at the top, sticking to the bottom when new messages arrive.
- Each message is `data-mt="message"` with `data-mt-variant="in|out"` and `data-mt-state="<status>"`, and shows the sender's short name, the text and a relative time (`date-fns`).
- Scrolling to the top loads older messages from the REST cursor endpoint.

**Test:** a component test with 5,000 messages keeps the rendered message count under 100. Scrolling to the top triggers exactly one fetch with the right `before`. An outbound message shows its status.

### Step 9.6 — Message composer

- Add `data-mt="composer"` with a text input, a live UTF-8 byte counter and a send button.
- Disable sending when the text is empty, over the byte limit, or the node isn't `connected`. Enter sends and Shift+Enter adds a newline.
- Post to the send endpoint and clear the input on success. The message then appears through `message.new`, not optimistically.
- Show an error when the server returns 409 or 429.

**Test:** a component test checks the counter for a multibyte emoji string, the disabled states, and that Enter calls the API once. Playwright against FakeNode in `ack` mode: send "hello" and see it appear and reach `acked`. Then confirm FakeNode received exactly one text transmit.

### Step 9.7 — Node list (basic)

- On `/nodes`, show a table with long name, short name, hex ID, hardware, last heard (relative), SNR and hops. Sort by last heard, newest first, and highlight my node. Rows are `data-mt="node-row"`.

**Test:** a component test shows the scenario's node count and correct sort order. After a `node.upsert` arrives for an existing node, that row updates without a full re-render of the list. Check that through the row key stability.

### Step 9.8 — Direct messages

- Clicking a node row opens `/dm/:nodeNum`, which reuses the message list and composer in DM mode by sending `to` instead of `channel`.
- Inbound DMs from that node appear live.

**Test:** in Playwright, open a DM with a FakeNode peer and send text. FakeNode receives a packet whose `to` equals that node number. A `FakeNode.injectText` DM from the peer appears in the open conversation and not in channel 0.

---

## Phase 10 — Packaging

### Step 10.1 — Dockerfile

- Write a multi-stage build:
  - the build stage installs dependencies with pnpm, builds `apps/web` and `apps/server`, and compiles `better-sqlite3`
  - the runtime stage is `node:26-alpine` with production dependencies only
- Run as non-root user `1000:1000`. Declare `/data` as a volume. Expose 8080. Add a `HEALTHCHECK` against `/healthz`.

**Test:**

- `docker build` succeeds and the image is under 200 MB.
- `docker run` with a FakeNode host shows `healthy` within 30 seconds.
- `docker exec … id -u` prints 1000.
- `/data/meshterm.db` exists on the mounted volume.

### Step 10.2 — Compose files

- Add `docker-compose.yml` matching the design doc example.
- Add a minimal `README.md` with the "trusted networks only, no auth yet" warning near the top.
- Add `compose.test.yml`, which runs FakeNode as its own service and points MeshTerm at it. FakeNode needs a small CLI entry point that takes a scenario file.

**Test:** `docker compose -f compose.test.yml up` brings the UI up at `localhost:8080` showing `connected`. Inject a message using the FakeNode CLI, then restart the MeshTerm container. The message is still in the channel history after the restart.

### Step 10.3 — Continuous integration

- Add a GitHub Actions workflow on push and PR: install with a pnpm cache, then run `typecheck`, `lint`, `test:unit`, `test:int`, the Playwright tests (with installed browsers) and an amd64 `docker build`. Upload Playwright reports when a run fails.
- Add the final command list to `CLAUDE.md`.

**Test (deferred until a GitHub repo exists):** the workflow passes on a clean branch. A branch with a deliberately failing unit test turns the workflow red at the test step.

---

## Phase 11 — Base-app gate

### Step 11.1 — End-to-end gate test

Write one Playwright spec, run against the built app and FakeNode, that does all of the following:

1. Opens two separate browser contexts on channel 0.
2. Sends a message from context A, and both contexts show it reaching `acked`.
3. Injects a channel message from FakeNode, and both contexts show it.
4. Calls `FakeNode.reboot(5000)`. Both pills go to `reconnecting` and then back to `connected` without a page reload.
5. Sends again from context B after recovery, and it succeeds.
6. Restarts the server process, reloads both pages, and confirms all three messages are still shown.
7. Finishes with a transmit audit that shows exactly two text transmits (one per send) and nothing else besides handshakes and heartbeats.

**Test:** the spec passes three runs in a row in CI, so it isn't flaky.

### Step 11.2 — Documentation close-out

- Update `memory-bank/architecture.md`: every package and module with a one-line responsibility, the full database schema, the WS protocol as built, and the `data-mt` hook list.
- Make sure `DECISIONS.md` covers every choice made along the way.
- Add screenshots of the channel view, node list and DM view at 390 px and 1280 px in the Default theme as Playwright visual baselines.

**Test:** another developer (or a fresh AI session) can follow `CLAUDE.md` alone to install, run against FakeNode with Docker Compose, and pass `pnpm test`. The visual baselines are committed and the visual test passes.

---

## Out of scope

The following will be planned in later documents. Don't build them now, but don't block them either.

- Map, positions, traceroute, node detail page, neighbors
- Telemetry and charts
- Device and module config editor, and admin actions (reboot, factory reset and so on)
- Packet log, raw debug console, notifications and sounds
- Reactions, unread counts, favorites UI
- Theme loader, hot reload, theme picker, the Cyberpunk and Retro Terminal themes, `THEMING.md`, effects layer
- Auth, roles, CSRF, audit log, trusted-proxy auth. **Until auth lands, the base app is for trusted networks only.** Say so in the README.
- HTTP transport fallback, multi-node UI, nightly backups, arm64 image
