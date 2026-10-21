# CR-002 — Device Config Editor

| Field        | Value                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Project      | MeshTerm                                                                                                         |
| CR ID        | CR-002                                                                                                           |
| Title        | Device config editor (local node)                                                                                |
| Requested by | Fireshaper                                                                                                       |
| Date         | 2026-10-20                                                                                                       |
| Priority     | High: required for MeshTerm to replace the phone app                                                             |
| Type         | Enhancement                                                                                                      |
| Depends on   | NodeConnection handshake (config/moduleConfig/channel packets already received), auth roles, audit log, FakeNode |
| Related      | `app-design-document.md` §6 and §9, CR-001                                                                       |

---

## 1. Summary

Add a **Settings → Device** area where an admin can view and change every setting on the connected node (owner, device role, LoRa, channels, position, power, network, display, Bluetooth, security and all modules) and run maintenance actions (reboot, shutdown, NodeDB reset, factory reset), with no phone app needed.

Edits are staged locally, shown as a reviewable diff, applied in one transaction (`begin_edit_settings` → `set_*` → `commit_edit_settings`), and then **verified** by re-reading the config after the node reboots and reconnects.

## 2. Motivation

- Today any config change needs the phone app or the Python CLI, so MeshTerm can't stand alone.
- The node already sends its full config during the handshake, so MeshTerm has everything needed to render it.
- Applying settings over IP has real risks (lockout by changing network settings, illegal region/power, managed mode), so this needs guard rails the phone app doesn't need.

## 3. Scope

### In scope

- Owner (long/short name, licensed/ham flag)
- All `Config` sections: Device, Position, Power, Network, Display, LoRa, Bluetooth, Security
- All `ModuleConfig` sections the firmware reports (MQTT, Serial, External Notification, Store & Forward, Range Test, Telemetry, Canned Message, Audio, Remote Hardware, Neighbor Info, Ambient Lighting, Detection Sensor, Paxcounter, and any added later)
- Channels 0–7: name, PSK, role, uplink/downlink, position precision, mute; add/remove/reorder secondary channels
- Channel set import/export via Meshtastic channel URL and QR code
- Fixed position: set by lat/lon entry or by clicking on the map
- Staged edits, diff review, transactional apply, post-reboot verification
- Config backup (export) and restore (import with diff), YAML compatible with `meshtastic --export-config`
- Maintenance: reboot, shutdown, reset NodeDB, factory reset (config only / full)
- Safety guards (§7), audit log entries, admin-only access

### Out of scope (future CRs)

- Remote administration of **other** nodes over the mesh (PKI admin keys)
- Firmware update / OTA
- Scheduled or automated config changes
- Multi-node bulk config

## 4. Protocol (how it works)

All configuration uses `AdminMessage` protobufs sent to **our own node number** on the `ADMIN_APP` port over the existing TCP/HTTP API connection. Admin messages to the local node go over the API link, not over LoRa.

| Operation              | AdminMessage field                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Read a config section  | `get_config_request` → `get_config_response`                                                                 |
| Read a module section  | `get_module_config_request` → `get_module_config_response`                                                   |
| Read a channel         | `get_channel_request` (index + 1) → `get_channel_response`                                                   |
| Read owner             | `get_owner_request` → `get_owner_response`                                                                   |
| Start edit transaction | `begin_edit_settings`                                                                                        |
| Write                  | `set_config`, `set_module_config`, `set_channel`, `set_owner`, `set_fixed_position`, `remove_fixed_position` |
| Finish transaction     | `commit_edit_settings` (node saves and reboots if required)                                                  |
| Maintenance            | `reboot_seconds`, `shutdown_seconds`, `nodedb_reset`, `factory_reset_config`, `factory_reset_device`         |

**Session passkey:** current firmware requires a valid `session_passkey` on admin set operations. The node returns one in every admin get response. The server must:

1. Issue at least one `get_*` request before any `set_*`.
2. Store the latest passkey per connection and attach it to every admin message.
3. Refresh it (another `get_*`) if a set is rejected for an expired/invalid key, then retry once.

Use the generated types from `@meshtastic/protobufs`; never hand-write field numbers. Exact field and enum names must come from the protobuf version pinned for the build.

## 5. UX

### 5.1 Navigation

`/settings/device` with a left section list (top tabs on mobile):

```
Device settings          K7AB · fw 2.x · ● connected
──────────────────────────────────────────────────
User            Owner name, short name, licensed
Device          Role, rebroadcast, intervals, time zone…
LoRa            Region, preset, hop limit, TX power…
Channels        0 Primary · 1 Augusta · 2 Admin
Position        GPS, fixed position, broadcast…
Power           Power saving, sleep, shutdown…
Network         WiFi, Ethernet, static IP, NTP…      ⚠ can disconnect MeshTerm
Display         Screen, units, orientation…
Bluetooth       Enabled, pairing mode, PIN
Security        Keys, admin keys, managed mode…      ⚠
Modules ▸       MQTT, Telemetry, Store & Forward…
Backup & restore
Maintenance     Reboot, shutdown, resets               ⚠
```

A badge on each section shows unsaved edits (`•3`).

### 5.2 Section form

- Fields grouped with headings; each field has a label, help text, unit, and current value.
- Changed fields are highlighted, with "was: …" shown underneath and a per-field reset (↺).
- Fields that require a reboot carry a "reboot" tag.
- Dangerous fields carry a ⚠ tag and explain the consequence inline.
- Conditional fields hide/show based on others (e.g. LoRa bandwidth/spreading factor/coding rate only when "Use preset" is off; static IP fields only when address mode is static).
- Validation is inline (ranges, lengths, formats) and blocks apply until fixed.

### 5.3 Staging, review and apply

Edits across any number of sections accumulate in a **pending changes** tray at the bottom:

```
┌──────────────────────────────────────────────────────────────┐
│ 5 pending changes in 3 sections · node will reboot           │
│ [Discard all]                       [Review & apply →]       │
└──────────────────────────────────────────────────────────────┘
```

**Review dialog**

```
Review changes
──────────────
LoRa
  Hop limit            3  →  4
  TX power (dBm)       0  →  20        ⚠ Check your region's legal limit
Device
  Role                 CLIENT → CLIENT_MUTE
Channels
  #1 Augusta  PSK      (changed)
Modules · Telemetry
  Device update interval   1800 → 900 s

The node will save settings and reboot. MeshTerm will reconnect
automatically (usually 20–60 s).

[Cancel]   [Apply 5 changes]
```

- Secrets (PSKs, WiFi password, private key) are shown as "(changed)", never in clear text in the diff.
- If any ⚠ lockout-class change is included (§7.1), the apply button requires typing the node's short name.

**Apply flow (server)**

1. Refresh session passkey (`get_*`).
2. Check the node's current config still matches what the editor was based on (compare against the latest received config). If it differs, abort with a conflict (§5.5).
3. `begin_edit_settings`.
4. Send one `set_*` per changed section/channel/owner, in a stable order: owner → channels → config sections → module sections.
5. `commit_edit_settings`.
6. Connection state shows `applying → rebooting → reconnecting → verifying`.
7. After reconnect and handshake, compare the received config with the intended config.
8. Report the result: **Applied and verified**, or **Applied with differences**, listing each field where the node's value differs from what was sent (firmware may clamp or reject values).

If the node doesn't reconnect within 3 minutes, show a recovery panel: the last known IP, what changed (especially network settings), and how to recover (serial/Bluetooth via the phone app, or factory reset).

Apply progress is pushed over WS (`config.apply` events), so other open browsers see the node is being reconfigured and their editors lock.

### 5.4 Channels editor

- List of channel slots 0–7: index, role badge (Primary/Secondary/Disabled), name, encryption status, uplink/downlink, position precision.
- **Edit channel:** name (≤ 11 chars), role, PSK, uplink/downlink toggles, position precision (slider with approximate radius shown, e.g. "~1.5 km"), muted.
- **PSK options:** Default key (`AQ==`, shown as "Default, public"), None (unencrypted, ⚠), Random 128-bit, Random 256-bit (default for new channels), or paste base64. Show/hide toggle and copy button. Random keys come from the server's CSPRNG.
- Add secondary channel into the first disabled slot; remove = set role Disabled. Primary can't be removed.
- Reorder secondaries by drag (re-indexes on apply; warn that other nodes match channels by name + key, not index).
- **Export:** generates the Meshtastic channel URL (`https://meshtastic.org/e/#<base64url ChannelSet>`) for selected channels plus LoRa settings, with a QR code. Warn that the URL contains the keys.
- **Import:** paste URL or scan QR (camera, where available). Show a diff of channels and LoRa settings, with a choice to **Add** the channels to free slots or **Replace** all channels. Applies through the normal review flow.

### 5.5 Conflicts

- If `config.updated` arrives for this node while a user has pending edits (another browser or the phone app changed it), mark affected fields "changed on device" and require a refresh of those fields before apply.
- Only one apply can run per node at a time; others get "Apply in progress by <user>".

### 5.6 Fixed position

In the Position section, when "Fixed position" is on:

- Enter lat/lon/alt, or click "Pick on map" to open a map picker (reuses the map component) and click a point.
- Applies with `set_fixed_position`; turning it off uses `remove_fixed_position`.
- Warn that the position is broadcast according to the channel's position precision.

### 5.7 Backup & restore

- **Export:** downloads YAML containing owner, all config, all module config, channels (and channel URL), and fixed position. Compatible with the Python CLI's `--export-config` format. Optional "exclude secrets" toggle (default **on** for safety). File name `meshterm-<shortname>-<date>.yaml`.
- **Import:** upload YAML → parse → show the review diff exactly like manual edits → apply. Unknown keys are listed and skipped. Network and security sections are unchecked by default and must be opted into.
- MeshTerm also keeps an automatic snapshot of the node's full config in the DB before every apply (`config_snapshots` table, keep last 20). "Restore this snapshot" loads it into the editor as pending changes.

### 5.8 Maintenance

| Action                 | Confirmation                                                      | Notes                                                                                       |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Reboot                 | Simple confirm                                                    | `reboot_seconds = 2`                                                                        |
| Shutdown               | Confirm + warning that it won't come back without physical access |                                                                                             |
| Reset NodeDB           | Confirm                                                           | Clears the node's node list; MeshTerm's own history is kept                                 |
| Factory reset (config) | Type short name                                                   | Keeps keys / BLE bonds as firmware defines                                                  |
| Factory reset (device) | Type short name + 5 s countdown                                   | Wipes everything; network settings likely lost → MeshTerm will probably lose the connection |

All maintenance actions take a fresh config snapshot first.

## 6. Field metadata registry

Forms are generated, not hand-built per field:

1. **Protobuf reflection** provides the field list, types and enums for every section from the pinned `@meshtastic/protobufs` version, so new firmware fields appear automatically (rendered generically under "Other").
2. A hand-maintained **metadata registry** (`apps/web/src/features/config/registry.ts`) overlays UX details keyed by field path, e.g. `lora.tx_power`:

```ts
interface FieldMeta {
  label: string;
  help: string;
  group?: string; // heading within the section
  unit?: "s" | "ms" | "dBm" | "MHz" | "kHz" | "m" | "%" | "V";
  min?: number;
  max?: number;
  step?: number;
  enumLabels?: Record<string, string>;
  secret?: boolean; // masked, never shown in diffs
  requiresReboot?: boolean;
  danger?: "warn" | "lockout"; // see §7
  visibleIf?: (cfg: DeviceConfigState) => boolean;
  validate?: (value: unknown, cfg: DeviceConfigState) => string | null;
  advanced?: boolean; // hidden behind "Show advanced"
}
```

3. Fields with no registry entry render with the protobuf field name humanized and are placed under "Advanced".

The registry ships with entries for every field in the sections listed in §3. Help text should be concise and match the official Meshtastic config docs.

## 7. Safety guards

### 7.1 Lockout-class changes (typed confirmation + recovery note)

| Change                                                                            | Risk                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Network: disable WiFi/Ethernet, change SSID/PSK, change address mode or static IP | MeshTerm loses its connection; node may become unreachable over IP                         |
| Security: enable managed mode                                                     | Node refuses local config changes except from an admin key; MeshTerm can no longer edit it |
| Security: regenerate private key                                                  | Breaks existing PKI DMs and admin trust with other nodes                                   |
| Security: disable the API/serial interfaces the connection depends on             | Connection loss                                                                            |
| Bluetooth: disable while the user depends on the phone app for recovery           | Warn only                                                                                  |
| Factory reset (either)                                                            | Network settings likely lost                                                               |

For network changes, the review dialog shows the **new address MeshTerm will try**. After reboot, the server attempts the old address first, then the new static IP/hostname if one was set, and updates the connection record when it succeeds.

### 7.2 Warn-class changes (inline warning, normal confirm)

- **LoRa region:** must be set; changing it affects legal frequencies. Unset region blocks apply of other LoRa changes.
- **TX power** above the region's legal max: warn with the limit; 0 means "use region default".
- **TX enabled = off:** node will stop transmitting.
- **Licensed (ham) mode on:** encryption is disabled on all channels and the callsign should be the long name; explicit warning.
- **Role ROUTER / ROUTER_LATE / REPEATER:** warn that these are for well-placed infrastructure nodes and can harm the mesh if misused.
- **Hop limit > 3:** warn about airtime cost.
- **PSK = none:** channel becomes unencrypted.
- **Override duty cycle:** warn about regional regulations.
- **Very short broadcast intervals** (position, node info, telemetry below firmware defaults): warn about airtime.

### 7.3 Access and audit

- Admin role only. Viewer sees a read-only version with secrets masked.
- All endpoints require CSRF token and are rate-limited (1 apply per 30 s per node).
- Every apply, import, snapshot restore and maintenance action writes an audit log entry: user, time, sections changed, field paths (no secret values), result.
- No config message is ever sent without an explicit user apply (covered by the no-transmit audit; reads during the handshake are the only automatic admin traffic).

## 8. Data and API

### 8.1 Storage

```
config_snapshots(id, connection_id, taken_at, reason ('pre-apply'|'pre-maintenance'|'manual'),
                 payload JSON, firmware_version)
```

Secrets in snapshots are encrypted at rest with a key from `MESHTERM_SECRET_KEY` (env var, generated on first run into `/data` if unset).

The live config is already held in memory from the handshake; expose it through the API with secrets masked for viewers.

### 8.2 Endpoints

| Endpoint                                                      | Purpose                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/connections/:id/config`                             | Full current config, module config, channels, owner, fixed position, plus `configVersion` (hash) and firmware version                            |
| `POST /api/connections/:id/config/apply`                      | Body `{ baseVersion, changes: { owner?, config?: {section: partial}, moduleConfig?: {...}, channels?: [...], fixedPosition? } }` → `{ applyId }` |
| `GET /api/connections/:id/config/apply/:applyId`              | Status + verification result                                                                                                                     |
| `POST /api/connections/:id/config/refresh`                    | Re-read all sections from the node (get requests)                                                                                                |
| `GET /api/connections/:id/config/export?secrets=false`        | YAML download                                                                                                                                    |
| `POST /api/connections/:id/config/import`                     | Upload YAML → returns parsed changes (does not apply)                                                                                            |
| `GET /api/connections/:id/config/snapshots` / `GET …/:snapId` | List / load snapshots                                                                                                                            |
| `GET /api/connections/:id/channels/url?indexes=0,1`           | Channel URL + QR (PNG/SVG)                                                                                                                       |
| `POST /api/connections/:id/channels/url/parse`                | Parse a channel URL → channel set + LoRa settings                                                                                                |
| `POST /api/connections/:id/maintenance`                       | Body `{ action: 'reboot'                                                                                                                         | 'shutdown' | 'nodedb_reset' | 'factory_reset_config' | 'factory_reset_device', confirm }` |

WS events: `config.updated` (exists), `config.apply` (`{ applyId, phase, error? }`), `config.verified` (`{ applyId, mismatches[] }`).

## 9. Testing

- **FakeNode** gains admin support: answers `get_*` with configurable state and session passkeys, rejects sets with a bad/missing passkey, honours begin/commit, simulates reboot (drops the connection for N seconds), can clamp values (to test "applied with differences"), and can simulate a network change that moves it to a new address or never comes back.
- Unit tests: diff builder, secret masking, registry validation, YAML import/export round trip (including against a real CLI export fixture), channel URL encode/decode round trip against known-good URLs.
- Playwright: edit LoRa + module + channel → review → apply → reboot → verified; conflict path; lockout typed confirmation; import with Add vs Replace.
- Manual smoke test checklist against a real node before release (region unchanged, low-risk changes only).

## 10. Acceptance criteria

- [ ] Every Config and ModuleConfig section the firmware reports is viewable and editable; unknown new fields render generically
- [ ] Owner name, short name and licensed flag editable
- [ ] Channels: edit name/role/PSK/uplink/downlink/precision; add/remove secondaries; random 128/256-bit keys
- [ ] Channel URL + QR export; URL import with Add/Replace and diff
- [ ] Fixed position settable by coordinates or map click, and removable
- [ ] Edits across sections are staged, reviewed as one diff (secrets masked) and applied in one begin/commit transaction
- [ ] Session passkey handled, including refresh-and-retry on rejection
- [ ] After reboot MeshTerm reconnects, re-reads config and reports verified or lists mismatches
- [ ] Network changes: new address tried automatically; recovery panel after 3 min with no reconnect
- [ ] Lockout-class changes require typing the short name; warn-class changes show inline warnings
- [ ] Pre-apply snapshot saved; snapshots can be loaded back as pending changes
- [ ] YAML export/import compatible with the Python CLI format; secrets excluded by default
- [ ] Maintenance actions work with the specified confirmations and snapshot first
- [ ] Concurrent changes detected (conflict) and only one apply per node at a time; other browsers lock during apply
- [ ] Viewer role: read-only, secrets masked, no maintenance
- [ ] Audit log entry for every apply/import/restore/maintenance action, without secret values
- [ ] FakeNode admin fixtures and tests listed in §9 pass in CI
- [ ] All screens styled in the three built-in themes; Playwright screenshots added; usable at 390 px

## 11. Theming hooks

`data-mt="config-view"`, `"config-nav"`, `"config-nav-item"` (state `active`, `dirty`; variant `danger` for Network/Security/Maintenance), `"config-section"`, `"config-group"`, `"config-field"` (state `changed`, `invalid`, `conflict`; variant `secret`, `danger-warn`, `danger-lockout`), `"field-was"`, `"reboot-tag"`, `"danger-tag"`, `"pending-tray"`, `"review-dialog"`, `"diff-row"`, `"typed-confirm"`, `"apply-progress"` (state = phase), `"channel-slot"` (variant `primary|secondary|disabled`), `"psk-field"`, `"qr-code"`, `"recovery-panel"`.

Tokens: reuse existing status tokens; add `--mt-field-changed-bg`, `--mt-field-conflict-bg`, `--mt-danger-surface`.

## 12. Risks

| Risk                                               | Mitigation                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Locking yourself out via network/security settings | Typed confirmation, new-address auto-retry, recovery panel, pre-apply snapshot                                         |
| Firmware differences in fields/enums               | Reflection-driven forms; registry only overlays UX; verification step catches clamped/ignored values                   |
| Session passkey behavior differs by firmware       | Always get-before-set; refresh-and-retry once; clear error if still rejected                                           |
| Partial apply if connection drops mid-transaction  | All sets inside begin/commit; if commit isn't acknowledged, re-read config and show the actual state                   |
| Secrets leaking via UI, logs or exports            | Masking in diffs/viewer, no secrets in audit log or Pino logs, exports exclude secrets by default, snapshots encrypted |
| Illegal RF settings                                | Region required, TX power warnings, duty-cycle warning                                                                 |

## 13. Estimate

| Part                                                                                                       | Effort              |
| ---------------------------------------------------------------------------------------------------------- | ------------------- |
| Server admin layer (passkey, get/set, begin/commit, apply orchestration, verify, reconnect-to-new-address) | 2–2.5 days          |
| Field registry + reflection-driven form renderer + validation                                              | 2 days              |
| Staging, diff/review, conflicts, apply progress UI                                                         | 1.5 days            |
| Channels editor + URL/QR import/export                                                                     | 1.5 days            |
| Fixed position picker, backup/restore YAML, snapshots                                                      | 1.5 days            |
| Maintenance actions, safety guards, audit                                                                  | 1 day               |
| FakeNode admin support, tests, theming, screenshots                                                        | 1.5–2 days          |
| **Total**                                                                                                  | **~11–12 dev days** |

Suggested split if needed: **CR-002a** (server admin layer, generated forms, review/apply/verify, LoRa/Device/Position/Power/Display/Bluetooth/User, maintenance) then **CR-002b** (channels editor + URL/QR, network/security with lockout guards, modules, backup/restore).
