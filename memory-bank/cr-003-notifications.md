# CR-003 — Message Notifications (Tab, In-App, Desktop)

| Field        | Value                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Project      | MeshTerm                                                                                                                   |
| CR ID        | CR-003                                                                                                                     |
| Title        | Notifications for incoming messages                                                                                        |
| Requested by | Fireshaper                                                                                                                 |
| Date         | 2026-10-21                                                                                                                 |
| Priority     | High                                                                                                                       |
| Type         | Enhancement                                                                                                                |
| Depends on   | Messages overhaul (`messages-spec.md`): `conversation_state`, unread counts, `message.new` / `conversation.read` WS events |
| Supersedes   | `messages-spec.md` §7 (Notifications)                                                                                      |

---

## 1. Summary

When a message arrives, the user should know immediately, wherever they are in MeshTerm and even if the tab is in the background:

1. **Browser tab:** unread count in the title, badge on the favicon, optional title flash.
2. **In-app:** toast popups with sender, preview and quick actions; unread badges on the nav; a notification center (bell) with recent history.
3. **Sound:** themeable alert sounds.
4. **Desktop/OS notifications:** native notifications via the Notification API when the tab isn't focused.

All of it is driven by one set of rules (DMs, mentions, per-conversation levels, Do Not Disturb), so every channel behaves consistently.

## 2. Current behavior

- Unread counts appear in the conversation list only.
- Nothing happens when a message arrives on another page or while the tab is in the background.

## 3. Scope

### In scope

- Notification rules engine (client-side, fed by server hints)
- Tab title count, favicon badge, title flash
- Toasts, Messages nav badge, notification center
- Sounds with theme overrides
- OS notifications (permission flow, click-to-open, per-conversation tags)
- One-tab-only alerting when several MeshTerm tabs are open
- Backlog handling after reconnect
- Mention detection and highlighting
- Settings UI (global, per-device, per-conversation)

### Out of scope (future CRs)

- Push notifications with no MeshTerm tab open (Web Push / service worker, ntfy, Gotify, webhooks); see the planned Alerts CR
- Non-message alerts (node offline, low battery). The rules engine and toast component must be reusable for them.

## 4. What triggers a notification

| Event                                 | Default level   | Notes                                                                         |
| ------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| Incoming DM                           | **Notify**      | Always, unless that DM is muted or DND is on                                  |
| Channel message that mentions me      | **Notify**      | See §4.1                                                                      |
| Any other channel message             | **Notify**      | Per-channel override to "Mentions" or "None" (changed 2026-10-22; was silent) |
| Reaction to one of my messages        | **In-app only** | Toast + bell, no sound/OS notification by default                             |
| Reply to one of my messages (channel) | **Notify**      | Treated like a mention                                                        |
| My own outgoing messages, ACKs        | Never           |                                                                               |
| Messages from ignored nodes           | Never           |                                                                               |

**Per-conversation level** (stored server-side in `conversation_state.notify_level`):

- `all`: every message notifies (channel default)
- `mentions`: only mentions/replies to me
- `dm-default`: DMs notify (DM default)
- `none`: badge only, no toast/sound/OS notification (this is what "Mute" sets)

**Suppression:** no toast, sound or OS notification when the message's conversation is open, visible, scrolled to the bottom, and the tab is focused. The message just appears in the thread.

### 4.1 Mentions

A channel message is a mention when its text contains, case-insensitively and on word boundaries:

- `@` + my short name (e.g. `@K7AB`), or my short name alone
- my long name
- any extra keywords the user adds in Settings (e.g. a callsign, "base")

Mention detection runs **on the server** when the message is stored and sets `messages.mentions_me = 1`, so every browser and future push channels agree. The server re-reads the owner name on `config.updated`. Mentioned words are highlighted in the bubble (`data-mt="mention"`).

### 4.2 Do Not Disturb and quiet hours

- **DND toggle** in the header (bell menu): suppresses toasts, sounds and OS notifications; badges and the bell still count. Options: 1 h, until tomorrow, until turned off.
- **Quiet hours** (e.g. 22:00–07:00, server time zone): same as DND during that window; optional "Allow DMs during quiet hours".
- DND state is per user and synced across browsers via the server.

### 4.3 Backlog after reconnect

After the node reconnects, it may deliver a burst of messages that arrived while MeshTerm was disconnected. These must **not** fire one alert each.

- The server marks a stored message `is_backlog = 1` if it arrives within 30 s of `config_complete` **and** its `rx_time` is more than 60 s older than the moment it was stored, or if the connection was down when `rx_time` occurred.
- Backlog messages update unread counts and appear in the bell, but produce at most **one summary toast** per reconnect: "12 messages arrived while disconnected (3 DMs)" with an "Open Messages" action. No sound unless at least one is a DM; one OS notification at most.
- Messages whose `rx_time` is more than 24 h old never notify.

## 5. Tab notifications

| Feature                                | Behavior                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Title count**                        | `(N) MeshTerm`, where N = total unread across DMs + channels at level `all`, plus all unread mentions. Muted/`none` conversations don't count toward the title (they still show their own badge). Caps at `(99+)`.                                     |
| **Favicon badge**                      | Draws the theme's icon onto a 64×64 canvas with a count dot in the top-right corner (`--mt-badge-bg` / `--mt-badge-text`), then swaps the `<link rel="icon">` data URL. A dot without a number if count > 9 doesn't fit. Restores the plain icon at 0. |
| **Title flash** (optional, default on) | When the tab is hidden and a notifying message arrives, alternate the title between `(N) MeshTerm` and `💬 K7AB: Heading out…` (truncated to 40 chars) every 1.5 s until the tab is focused. Disabled in DND.                                          |
| **Connection state**                   | If the node is disconnected, prefix the title with `⚠ ` so a background tab shows it.                                                                                                                                                                  |

## 6. In-app notifications

### 6.1 Toasts

```
┌──────────────────────────────────────┐
│ ● K7AB · Direct message          ✕   │
│ Heading out now, see you at the shop │
│ [Reply]  [Mark read]       just now  │
└──────────────────────────────────────┘
```

- Position: top-right on desktop, top-center full-width on mobile, below the header.
- Stack up to 3; older ones collapse into "+N more" which opens the bell.
- **Grouping:** further messages from the same conversation within 10 s update the existing toast ("3 new messages from K7AB", latest preview shown) instead of adding new ones.
- Auto-dismiss after 6 s (DMs: 10 s); hovering or focusing pauses the timer.
- Click anywhere on the toast opens the conversation (`/messages/dm/:nodeId` or `/messages/channel/:index`) and marks it read.
- **Reply** expands an inline single-line composer in the toast (same 200-byte limit and counter). Enter sends; the toast then shows "Sent ✓" briefly. Hidden for viewer role.
- **Mark read** marks the conversation read without navigating.
- Channel toasts show `#Channel · sender` in the header; mention toasts use `data-mt-variant="mention"` so themes can emphasize them.
- Toasts live in an `aria-live="polite"` region; DMs and mentions use `assertive`.

### 6.2 Badges

- Messages nav item: total unread (same rule as the title count), with a separate dot style if any unread item is a DM or mention (`data-mt-state="priority"`).
- Mobile bottom tab bar shows the same badge.
- Conversation list badges already exist; mention rows get an `@` marker.

### 6.3 Notification center (bell)

- Bell icon in the header with an unread notification count.
- Dropdown lists the last 50 notification events (newest first, grouped by conversation): avatar/short name, conversation, preview, time, unread dot.
- Click opens the conversation. "Mark all read" clears notifications and marks all their conversations read.
- Also holds the DND toggle, quiet-hours status and a link to notification settings.
- Notification history is kept client-side per browser (last 50, in memory + sessionStorage, try/catch); it's a convenience view of the messages table, not a separate store.

## 7. Sound

- Default sounds ship with the app: `message` (DM), `mention`, `channel` (only used for conversations set to `all`). Short (< 1 s), small files.
- A theme can override any of them via its manifest `sounds` map; the Retro theme ships a terminal beep, Cyberpunk a synth blip.
- Settings: master on/off, volume, per-type on/off. **Per browser** (localStorage), since a wall display and a laptop want different behavior.
- Browsers block audio until the user interacts with the page. Preload sounds and "unlock" the audio context on the first click/keypress; if a sound is blocked, fail silently.
- Throttle: at most one sound every 2 s.

## 8. Desktop/OS notifications

- Uses the Web Notifications API (`new Notification(...)`).
- **Permission flow:** never prompt on page load. Show a dismissible banner ("Get desktop notifications for DMs and mentions? [Enable]") on the Messages page after the first incoming DM or mention, and a toggle in Settings. Clicking Enable calls `Notification.requestPermission()`. If denied, Settings explains how to re-enable it in browser settings.
- Fires only when the tab is **hidden or unfocused**; when focused, toasts are enough.
- Content: title `K7AB (Kevin's Base)` or `#LongFast · K7AB`, body = message preview (60 chars), icon = theme icon.
- `tag` = conversation key, with `renotify: true`, so one notification per conversation is replaced rather than stacked.
- Clicking it focuses the MeshTerm tab, opens the conversation and closes the notification.
- Optional "Hide message text in desktop notifications" (shows "New direct message" only), for shared screens.

### 8.1 Secure context requirement

The Notification API only works in a **secure context**: HTTPS, or `http://localhost`. A plain `http://192.168.x.x:8080` address is **not** a secure context, so desktop notifications are unavailable there.

- Detect with `window.isSecureContext` and `'Notification' in window`.
- If unavailable, the Settings toggle is disabled with an explanation: put MeshTerm behind HTTPS (reverse proxy such as Caddy/Traefik/Nginx Proxy Manager with a local or real cert, or Tailscale HTTPS).
- Tab, toast, badge and sound notifications work regardless.
- Add a short "Enable HTTPS for desktop notifications" section to the README.

## 9. Multiple tabs and devices

- **Same browser, several tabs:** only one tab ("leader") plays sounds, flashes the title and shows OS notifications. Elect the leader with a `BroadcastChannel('meshterm-notify')` heartbeat; prefer the focused tab, else the most recently focused. All tabs still update titles, badges and toasts.
- **Different devices/browsers:** each alerts independently, using its own per-browser settings. Reading a conversation anywhere sends `conversation.read`, which clears badges, toasts, OS notifications (by tag) and title flash everywhere.

## 10. Settings UI

`Settings → Notifications`:

| Setting                                    | Scope        | Default                            |
| ------------------------------------------ | ------------ | ---------------------------------- |
| Desktop notifications                      | Browser      | Off until enabled                  |
| Hide message text in desktop notifications | Browser      | Off                                |
| Sounds on/off, volume, per type            | Browser      | On, 60 %                           |
| Title flash                                | Browser      | On                                 |
| Toasts on/off, position                    | Browser      | On, top-right                      |
| Notify on reactions to my messages         | User         | In-app only                        |
| Mention keywords                           | User         | (empty)                            |
| Quiet hours + allow DMs                    | User         | Off                                |
| Do Not Disturb                             | User         | Off                                |
| Per-conversation level                     | Conversation | DMs notify, channels mentions-only |

Per-conversation level is also editable from the conversation's context menu and the thread header (bell icon with All / Mentions / None).

## 11. Data and API changes

**`messages`:** add `mentions_me` (bool), `is_backlog` (bool), `is_reply_to_me` (bool, set when `reply_id` refers to one of my messages). Index `(connection_id, mentions_me, rx_time)`.

**`conversation_state`:** add `notify_level` (`all|mentions|dm-default|none`); `muted` maps to `none` (migrate existing rows).

**New `user_notification_prefs`:** `user_id, dnd_until, quiet_start, quiet_end, quiet_allow_dms, mention_keywords JSON, reactions_mode`.

**`message.new` WS event:** add a `notify` hint computed server-side:

```ts
notify: {
  level: "none" | "badge" | "notify";
  reason: "dm" | "mention" | "reply" | "reaction" | "channel-all" | null;
  backlog: boolean;
}
```

The client still applies per-browser settings, conversation-open suppression and DND on top.

**New WS event:** `notifications.backlog` `{ connectionId, count, dmCount, conversations[] }`, sent once after the backlog window closes.

**Endpoints:**

- `GET/PATCH /api/me/notification-prefs`
- `PATCH /api/connections/:id/conversations/:kind/:key` gains `notifyLevel`

## 12. Theming hooks

`data-mt="toast-region"`, `"toast"` (variant `dm|mention|channel|reaction|backlog|system`; state `grouped`, `leaving`), `"toast-reply"`, `"notification-bell"` (state `dnd`), `"notification-center"`, `"notification-item"` (state `unread`), `"nav-badge"` (state `priority`), `"mention"`, `"permission-banner"`, `"dnd-indicator"`.

Tokens: `--mt-badge-bg`, `--mt-badge-text`, `--mt-badge-priority-bg`, `--mt-toast-bg`, `--mt-toast-border`, `--mt-toast-shadow`, `--mt-toast-width`, `--mt-mention-bg`, `--mt-mention-text`, `--mt-toast-enter`/`--mt-toast-exit` (animation names; themes can set `none`).

Built-in themes: Cyberpunk toasts glow in on the accent color with a glitch entrance; Retro toasts render as an inverted status line (`*** K7AB: Heading out…`) with no animation.

## 13. Acceptance criteria

- [ ] Incoming DM while on another page: toast appears, sound plays, Messages badge increments, title shows `(1) MeshTerm`, favicon shows a badge
- [ ] Same DM while its thread is open and focused: no toast, no sound; it just appears
- [ ] Tab hidden: title flashes; OS notification shows if enabled (on HTTPS); clicking it opens the conversation
- [ ] Channel message without mention: notifies (channel default `all`); badge only at `mentions`. With `@shortname`, long name, keyword, or a reply to me: full notification, mention highlighted
- [ ] Per-conversation All / Mentions / None works for channels and DMs; Mute = None
- [ ] DND and quiet hours suppress toasts/sounds/OS notifications but keep counts; synced across browsers
- [ ] Reconnect with 20 queued messages produces one summary toast and at most one sound/OS notification
- [ ] Several toasts from one conversation group into one; max 3 visible
- [ ] Inline Reply in a toast sends a message (admin only) and respects the 200-byte limit
- [ ] Bell lists recent notifications; Mark all read clears badges everywhere
- [ ] With 3 tabs open, only one plays sound / shows the OS notification
- [ ] On `http://<LAN IP>` the desktop notification toggle is disabled with the HTTPS explanation; everything else works
- [ ] Reading a conversation on one device clears its badges, title count and OS notification on another
- [ ] Sounds overridable by theme; per-browser sound settings persist
- [ ] Screen reader announces DMs/mentions via the live region
- [ ] Styled in all built-in themes; Playwright screenshots of toast, bell and settings
- [ ] Tests: mention detection (word boundaries, case, unicode names), backlog classification, notify-level resolution, leader election, favicon/title logic

## 14. Risks

| Risk                                                       | Mitigation                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Desktop notifications silently unavailable over plain HTTP | Detect secure context, explain in Settings and README                                   |
| Alert storms after reconnect or on busy channels           | Backlog classification, grouping, 2 s sound throttle, channels default to mentions-only |
| False-positive mentions on short names (e.g. "BASE")       | Word-boundary match; user can disable short-name matching and rely on `@shortname` only |
| Duplicate alerts across tabs                               | BroadcastChannel leader election                                                        |
| Autoplay blocking                                          | Unlock audio on first interaction; fail silently                                        |

## 15. Estimate

| Part                                                                       | Effort              |
| -------------------------------------------------------------------------- | ------------------- |
| Server: mention/reply/backlog flags, notify hint, prefs, migrations, tests | 1 day               |
| Rules engine, tab title/favicon/flash, leader election                     | 1 day               |
| Toasts (grouping, inline reply), badges, bell / notification center        | 1.5 days            |
| Sounds, OS notifications + permission/secure-context handling              | 0.5–1 day           |
| Settings UI, theming, a11y, Playwright                                     | 1 day               |
| **Total**                                                                  | **~5–5.5 dev days** |
