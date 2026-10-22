# CR-003 Message notifications — build plan

CR: [cr-003-notifications.md](cr-003-notifications.md). Stop after each phase, report, commit and push.

## Where the code is today (2026-10-21)

- **Read state isn't built.** The CR depends on unread counts and the `conversation.read` event, but those were Messages Phase 3, which was paused for CR-001/CR-002:
  - `conversation_state` exists (migration 0007, with `last_read_rx_time`, `muted`, `favorite`, `deleted_before`), but nothing reads or writes it.
  - There's no `POST …/read`, no `PATCH …/conversations`, no unread counts in `ConversationsDTO`, no `conversation.read` / `conversation.updated` WS events, and no badges.
- **Messages:** `reply_id` and `emoji` (reactions) are ingested; replies and reactions aren't rendered (Messages Phase 4). Nodes have `is_ignored`.
- **Themes:** only Default exists. Cyberpunk and Retro Terminal, the theme picker, `theme.changed` and hot reload aren't built. `theme.json` has no `sounds` map yet.
- **Toasts:** a simple `ui-store` toast (`toast(text, kind)`) exists for app messages; nothing for message notifications.
- **Auth:** with `MESHTERM_AUTH=none` everyone is the single built-in admin (user id 0), so per-user prefs still work.

## Phase N0: read state and unread (Messages Phase 3, the CR's prerequisite) (done 2026-10-21)

- `POST /api/connections/:id/conversations/:kind/:key/read` `{upTo}`, `PATCH …/conversations/:kind/:key` (`muted`, `favorite`; `notifyLevel` in N1), `DELETE …/conversations/dm/:peer`.
- Unread counts in `ConversationsDTO` (and mention counts from N1), WS `conversation.read` and `conversation.updated`; the client patches the cache.
- Marked read after the thread has been at the bottom for 1 s while the tab is focused.
- Badges on conversation rows (99+), the Messages nav badge, the mobile tab bar badge, and the `(N) MeshTerm` title.
- Row menu: Mark read, Mute, Favorite, Delete (DM). "Show ignored".

## Phase N1: server — mentions, replies, backlog, notify hint, prefs (done 2026-10-22)

- Migration: `messages.mentions_me`, `is_backlog`, `is_reply_to_me` + index; `conversation_state.notify_level` (`muted` → `none`); `user_notification_prefs`.
- Mention detection when a message is stored: `@short`, short name alone, long name; case-insensitive, Unicode-aware word boundaries. Owner names re-read on `config.updated`. Users' keywords are matched per user when the hint is built (see the decision below).
- Reply to me: `reply_id` refers to one of my messages.
- Backlog classification (30 s window after `config_complete`, `rx_time` > 60 s old or while disconnected; > 24 h old never notifies) and one `notifications.backlog` event per reconnect.
- `message.new` gets `notify {level, reason, backlog}`, per WebSocket user (the conversation level, ignored nodes, reactions mode, keywords).
- `GET/PATCH /api/me/notification-prefs` (DND until, quiet hours + allow DMs, keywords, reactions mode, short-name matching); a WS event so DND syncs across a user's browsers.

## Phase N2: rules engine and the tab (done 2026-10-22)

- Client rules: the server hint, plus per-browser settings, DND/quiet hours, and suppression when the conversation is open, at the bottom and focused.
- Tab: title count (same rule as the nav badge, 99+), `⚠ ` while disconnected, favicon badge on a canvas (tokens `--mt-badge-*`), title flash while hidden.
- Leader election over `BroadcastChannel('meshterm-notify')` (focused tab first, else the most recently focused); only the leader flashes, plays sounds and shows OS notifications.
- Per-browser settings store (localStorage with try/catch).

## Phase N3: toasts, badges, bell, mentions

- Toast region (top-right; top-center on mobile): stack of 3 plus "+N more", grouping per conversation within 10 s, 6 s / 10 s with pause on hover/focus, click to open and mark read, Mark read, inline Reply (200-byte counter; admins only), polite/assertive live regions.
- Backlog summary toast; reaction toasts (in-app only).
- Messages nav badge with the `priority` state; `@` marker on mention rows; mentions highlighted in bubbles.
- Bell: count, last 50 events (sessionStorage), Mark all read, DND menu (1 h, until tomorrow, off), quiet-hours status, link to settings.

## Phase N4: sounds and desktop notifications

- Default sounds (`message`, `mention`, `channel`): short WAVs generated for the app. A theme's `theme.json` `sounds` map overrides them. Unlocked on the first interaction, 2 s throttle, volume and per-type switches.
- OS notifications: permission banner after the first DM/mention, secure-context detection with the HTTPS explanation, `tag` per conversation with `renotify`, click to focus and open, "hide message text". README section "Enable HTTPS for desktop notifications".

## Phase N5: settings, per-conversation levels, theming, tests

- `Settings → Notifications` (browser, user and per-conversation settings as in CR §10).
- Per-conversation level from the thread header bell and the row menu (All / Mentions / None).
- Tokens and `data-mt` hooks from CR §12 in the Default theme.
- e2e: DM on another page, open thread (no toast), mention, levels, DND, backlog summary, grouping, inline reply, three tabs. Visual baselines: toast, bell, settings.

## Not applicable yet

- Cyberpunk and Retro toast styles and their sounds: those themes don't exist yet. N4 adds the `sounds` map to the theme manifest, so they can ship them when they're built.
- Rendering replies and reactions in threads (Messages Phase 4); N1 still uses `reply_id` and reactions for notifications.

## Decisions to record when building

- `mentions_me` is stored for matches on the node owner's names (the same for everyone). User keywords are matched when the `notify` hint is built for each user's WebSocket, because keywords are per user while a message row is shared.
- Short-name matching can be switched off per user (CR §14); `@short` always counts.
