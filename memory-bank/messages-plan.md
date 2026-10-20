# Messages overhaul — build plan

Spec: [messages-spec.md](messages-spec.md). Stop after each phase, report, commit and push.

## §1 findings (2026-10-20)

Checked against the spec's five causes:

1. **Classification:** fine on the server. The channel history query already filters `peer IS NULL`, and DM history is by `peer`.
2. **Ingest:** every decoded `TEXT_MESSAGE_APP` is stored, and `peer = from` for non-broadcasts. Gap: a message _from our own node_ to someone (sent from another client on the same node, echoed to us) would get `peer = from` (ourselves) and `direction = in`. Fix: classify against `my_node_num`.
3. **UI (the real cause):** nothing lists DM conversations. `/dm/:nodeNum` exists, but it can only be reached from a node's "Message" button, and the channel screen has tabs for channels only. Incoming DMs from nodes you haven't opened are stored and pushed live, but you never see them.
4. **PKI:** the node hands us decoded packets, so they aren't skipped. But `pki_encrypted`, `via_mqtt`, `reply_id`, `emoji`, hops and the NAK reason aren't stored.
5. **Expectation:** we only get DMs addressed to our node. Correct, no change.

## Phase 1: ingest and data model (done 2026-10-20)

- Migration 0007:
  - `messages` gains `pki_encrypted`, `via_mqtt`, `reply_id`, `emoji`, `hop_start`, `hop_limit` and `error_reason`.
  - Channel index made partial (`WHERE peer IS NULL`).
  - `conversation_state` table.
- Decoder and persistence:
  - Store the new fields.
  - Classify DMs by destination against `my_node_num`.
  - Save the NAK reason on `failed`.
- Shared `Message` DTO gains the fields, and `message.status` carries `errorReason`.
- FakeNode can inject DMs with the PKI flag, MQTT, replies, reactions and an echo from our own node. It also gets a NAK reason option.
- Regression tests:
  - Incoming, outgoing, PKI and legacy DMs land with the right `peer`.
  - A message on a secondary channel.
  - A duplicate is deduped.
  - A NAK reason is stored.

## Phase 2: two-pane Messages view (done 2026-10-20)

- `GET …/conversations`: channels plus DMs, last message preview, unread count, muted/favorite.
- Routes:
  - `/messages`, `/messages/channel/:index`, `/messages/dm/:nodeId` (`!hex`).
  - `/channels/:i` and `/dm/:num` redirect to the new routes.
  - "Message" buttons elsewhere go to the DM route.
  - The nav gets "Messages".
- Conversation list:
  - Channel rows: modem preset name for an unnamed primary channel.
  - DM rows: status dot, preview, time, lock.
  - Name filter.
- Thread header: channel or DM (lock / open-lock).
- New DM picker with warnings (not heard for 24 h, no public key).
- Mobile: the list, then the thread with a back button.
- Last conversation remembered.

## Phase 3: read state and unread

- `POST …/read`, `PATCH`, `DELETE dm`; WS `conversation.read` and `conversation.updated`.
- Marked read after the thread has been at the bottom for 1 s while focused.
- Badges (99+), global nav badge, `(N) MeshTerm` title.
- Row menu: Mark read, Mute, Favorite, Delete. "Show ignored" (node `is_ignored`).

## Phase 4: thread and composer

- Message display:
  - Day separators and 5-minute grouping.
  - Sender chips colored from `--mt-chart-1…6`.
  - Metadata: hops, SNR/RSSI, MQTT.
- Delivery icons, with the failure reason and Retry.
- Replies and reactions (send and render).
- Message text:
  - Autolinks.
  - Infinite scroll upward (50) and "Jump to latest".
- Composer:
  - Enter / Shift+Enter.
  - UTF-8 byte counter (warn at 180, block above 200).
  - Reply bar and per-conversation drafts.
  - Disabled reasons and a "Slow down" notice on 429.

## Phase 5: search, notifications, visuals

- FTS5 over `messages.text` (triggers) and `GET …/messages/search`. Search results appear as a "Messages" section.
- Notifications:
  - DMs: browser notification and sound.
  - Channels: mentions, or "Notify all" per channel.
- Visual baselines for the Messages view.

## Not applicable yet

- Viewer role (no auth yet).
- Screenshots in "all built-in themes": only Default exists. Both come with their own milestones.
