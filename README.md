# MeshTerm

A self-hosted, themeable web client for [Meshtastic](https://meshtastic.org) nodes reachable over your network.

> [!WARNING]
> **Sign in is on by default.** The first visit asks you to create the admin account (or set `MESHTERM_ADMIN_USERNAME` / `MESHTERM_ADMIN_PASSWORD`). Admins can send and change settings; viewers can only look. MeshTerm speaks plain HTTP: put it behind HTTPS (a reverse proxy) before exposing it beyond a trusted network.

MeshTerm runs in one Docker container. It keeps a connection to your node over TCP (port 4403), stores history in SQLite, and serves a browser UI that any number of tabs and devices share live.

What works today: channel and direct messages with delivery status, a live node list, automatic reconnect when the node reboots, and history that survives restarts.

## Run it

You need a Meshtastic node with Wi-Fi or Ethernet (or `meshtasticd`) reachable from the Docker host.

1. Copy [`docker-compose.yml`](docker-compose.yml) (or paste it into Komodo, Portainer, …) and set `MESHTERM_NODE_HOST` to your node's IP address or hostname.
2. Start it:

   ```sh
   docker compose up -d
   ```

3. Open `http://<docker-host>:8080`.

Everything MeshTerm stores (`meshterm.db`) is in the `meshterm-data` named volume, which keeps its contents across redeploys and image updates.

**Prefer a host folder?** Change the volume to `./data:/data`, and create the folder first: the container runs as uid 1000, and a folder Docker creates for you is owned by root. MeshTerm then refuses to start with "Data directory /data is not writable".

```sh
mkdir -p data && sudo chown 1000:1000 data
```

Images are published for **amd64 and arm64** (e.g. a Raspberry Pi 4/5 with a 64-bit OS) as `ghcr.io/fireshaper/meshterm:latest`, plus a `:sha-<commit>` tag per build of `main`.

### Settings

| Variable                                             | Default                                          | Meaning                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `MESHTERM_NODE_HOST`                                 | (required)                                       | Node IP or hostname                                                                                                                   |
| `MESHTERM_NODE_PORT`                                 | `4403`                                           | Node TCP API port                                                                                                                     |
| `MESHTERM_HTTP_PORT`                                 | `8080`                                           | Web UI port inside the container                                                                                                      |
| `MESHTERM_DATA_DIR`                                  | `/data`                                          | Where the database lives                                                                                                              |
| `MESHTERM_LOG_LEVEL`                                 | `info`                                           | `debug`, `info`, `warn`, `error`, …                                                                                                   |
| `MESHTERM_HEARTBEAT_INTERVAL_MS`                     | `60000`                                          | Keep-alive to the node                                                                                                                |
| `MESHTERM_ACK_TIMEOUT_MS`                            | `120000`                                         | When an unacknowledged message is `failed`                                                                                            |
| `MESHTERM_TILE_URL`                                  | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map tile source (the server fetches and caches tiles; browsers never contact it)                                                      |
| `MESHTERM_TILE_CACHE_MB`                             | `500`                                            | Size cap of the tile cache in `/data/tiles`                                                                                           |
| `MESHTERM_AUTH`                                      | `local`                                          | `local`: accounts and sign-in (admin / viewer). `none`: no sign-in; everyone who can reach MeshTerm is an admin                       |
| `MESHTERM_ADMIN_USERNAME`, `MESHTERM_ADMIN_PASSWORD` | unset                                            | Creates the first admin at startup when no account exists (set both or neither; password ≥ 8 characters)                              |
| `MESHTERM_SESSION_DAYS`                              | `30`                                             | Sessions end after this many days (or after 7 days without use)                                                                       |
| `MESHTERM_SECRET_KEY`                                | generated                                        | 32-byte key (base64 or hex) that encrypts device-config snapshots. Unset: created once in `/data/secret.key` (keep `/data` backed up) |

Changing `MESHTERM_NODE_HOST` or `MESHTERM_NODE_PORT` later updates the same connection, so history is kept.

`GET /healthz` reports whether the process is up and each node connection's state. The image's `HEALTHCHECK` uses it.

## Try it without a radio

[`compose.test.yml`](compose.test.yml) builds MeshTerm from source and runs it against **FakeNode**, a simulated Meshtastic node:

```sh
docker compose -f compose.test.yml up --build
# then open http://localhost:8080, and make the fake mesh talk:
docker compose -f compose.test.yml exec fakenode pnpm cli inject --text "hello mesh"
```

## Develop

Requires Node 24+ and pnpm 10. See [`CLAUDE.md`](CLAUDE.md) for every command.

```sh
pnpm install
cp .env.example .env   # points the server at a local FakeNode
pnpm dev:fake          # FakeNode + server + web dev servers
```

Design docs live in [`memory-bank/`](memory-bank/) and decisions in [`DECISIONS.md`](DECISIONS.md).
