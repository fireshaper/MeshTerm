# CR-002 Device config editor — build plan

CR: [cr-002-device-config.md](cr-002-device-config.md). Stop after each phase, report, commit and push.

The user chose (2026-10-20) to **build login first**: CR-002 depends on admin/viewer roles and an audit log, which MeshTerm doesn't have.

## Where the code is today

- All AdminMessage operations the CR needs are in the pinned `@meshtastic/protobufs` 2.8.1:
  - Get/set config, module config, channels and owner.
  - Begin/commit edit settings, set/remove fixed position.
  - Reboot, shutdown, NodeDB reset, factory reset (config/device).
  - The `session_passkey` field.
- Schemas carry reflection data (`@bufbuild/protobuf` v2), so forms can be generated from them.
- The handshake already brings every `config`, `moduleConfig` and `channel` packet, but the decoder keeps only the LoRa preset and hop limit and drops PSKs (by design: no PSKs stored).
- No auth, users, sessions, CSRF or audit log. Every API and the WebSocket are open.
- The firmware allows one API client (the user also runs MeshDash, which made links flap). Admin traffic to the local node goes over that same link.

## Phase L: login, roles, audit log (done 2026-10-21)

- `MESHTERM_AUTH`:
  - `local` (default): accounts.
  - `none`: everyone is admin, for development and e2e.
  - Trusted-proxy header auth comes later.
- Migration:
  - `users` (username, argon2id hash, role `admin`|`viewer`).
  - `sessions` (hashed token, user, expiry, CSRF secret).
  - `audit_log` (time, user, action, target, details JSON without secrets, result).
- First run:
  - With no users, `/setup` creates the first admin; it's locked once any user exists.
  - Or seed from `MESHTERM_ADMIN_USERNAME` / `MESHTERM_ADMIN_PASSWORD`.
- Endpoints: `POST /api/auth/login` (rate-limited), `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/setup`, `PUT /api/auth/password`; admin: `GET/POST/PATCH/DELETE /api/users`, `GET /api/audit`.
- Enforcement:
  - Sessions: HTTP-only, `SameSite=Lax`, idle and absolute expiry.
  - Every API except `/healthz` and `/api/auth/*` needs a session; so does the WebSocket upgrade.
  - CSRF header on every non-GET.
  - Admin only: send, favorite, reconnect, user management (messages-spec: viewers can read but not send).
- Audit: login/logout/failed login, user changes, reconnect. Config actions from CR-002 later.
- Web:
  - Login page and first-run setup page, with an auth gate (redirect to `/login?next=`).
  - User menu (name, role, change password, log out).
  - Settings → Users (admin).
  - Viewer UI: composer, ★ and Reconnect disabled with a reason.
- Tests:
  - Unit and integration: hashing, sessions, CSRF, roles, WS rejection, setup lock, rate limit, audit.
  - e2e: existing instances run `MESHTERM_AUTH=none`; a new `auth` instance (local) covers setup → login → viewer limits → logout.

## Phase D1: config store, admin layer, apply/verify API (done 2026-10-21)

- An in-memory per-connection config store from the handshake: every Config and ModuleConfig section, channels with PSKs, owner, metadata. PSKs and secrets never go to the DB or logs; viewers get them masked. Exposed as `configVersion` (hash).
- Admin client:
  - `ADMIN_APP` to our own node number over the API link.
  - Request/response matching; session passkey stored, refreshed, retried once.
  - Get-before-set.
- Apply orchestration (one at a time per node):
  - Refresh passkey → conflict check against `baseVersion` → `begin_edit_settings` → sets (owner → channels → config → modules) → `commit_edit_settings`.
  - Phases `applying → rebooting → reconnecting → verifying` over WS (`config.apply`).
  - After reconnect, compare and report verified or mismatches (`config.verified`).
  - Recovery state after 3 min.
- `config_snapshots` (secrets encrypted with `MESHTERM_SECRET_KEY`, generated into `/data` if unset; keep 20), taken before every apply.
- Endpoints: `GET /config`, `POST /config/refresh`, `POST /config/apply`, `GET /config/apply/:id`, snapshots list/get. Rate limit: 1 apply per 30 s. Audit entries.
- FakeNode admin support:
  - Get responses with passkeys; rejects sets with a bad passkey.
  - Begin/commit and reboot.
  - Clamping, and a "moves to a new address" / "never comes back" mode.
- No-transmit audit: no admin message without an explicit apply.

## Phase D2: settings UI (core sections) (done 2026-10-21)

- `/settings/device`: section nav (desktop list / mobile tabs), dirty badges, connection line.
- Forms generated from protobuf reflection plus the `registry.ts` overlay:
  - Labels, help, units, ranges, enum labels, reboot/danger tags, conditional visibility, validation, advanced.
  - Unknown fields go under "Other".
- Sections: User, Device, LoRa, Position (fields), Power, Display, Bluetooth.
- Staging: per-field changed highlight, "was:", reset.
- Pending tray → review dialog: diff with secrets masked, warn-class notes, typed confirmation for lockout-class.
- Apply progress, verification result and recovery panel; conflicts ("changed on device") and locking while another apply runs.

## Phase D3: channels and fixed position

- Channels editor:
  - Slots 0–7: name, role, PSK (default / none / random 128 / random 256 / paste, show/copy), uplink/downlink, precision slider with radius, mute.
  - Add, remove, reorder.
- Channel URL export with QR (SVG, server-side) and URL import with diff (Add / Replace).
- Fixed position: lat/lon/alt fields or map picker; `set_fixed_position` / `remove_fixed_position`.

## Phase D4: network, security, modules, backup, maintenance

- Network and Security with lockout guards. The review shows the new address; after reboot, try the old then the new address and update the connection.
- Every ModuleConfig section the firmware reports (generic plus registry entries).
- Backup & restore:
  - YAML compatible with `meshtastic --export-config`, secrets excluded by default.
  - Import with diff; network/security opt-in.
  - Snapshot restore into pending changes.
- Maintenance (reboot, shutdown, NodeDB reset, factory reset config/device) with the confirmations and a snapshot first.
- Visual baselines.

## Not applicable yet

- "All three built-in themes": only Default exists.
- Remote admin of other nodes and OTA are out of scope (CR §3).
