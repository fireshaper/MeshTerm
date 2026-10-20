# MeshTerm — Messages Tab Overhaul Spec

Replaces the current single-channel view with a two-pane messenger. All channels **and** all direct messages appear in one conversation list, with unread counts, delivery status and a way to start a new DM.

It follows all rules in `app-design-document.md` §8: tokens only, `data-mt` hooks, no literal colors.

---

## 1. Why DMs don't show today (fix first)

Check these in order; the bug is almost certainly one of the first three.

1. **Classification by channel index.** DMs must be identified by **destination**, not channel. A packet is a DM when `to` is not the broadcast address `0xFFFFFFFF` and either `to == myNodeNum` (incoming) or `from == myNodeNum` (outgoing). Any query or filter of the form `channel_index = 0` / "main channel only" hides them.
2. **Ingest drops non-broadcast packets.** Confirm the packet handler stores every `TEXT_MESSAGE_APP` packet regardless of `to`, and sets the `peer` column (see §5): `peer = from` for incoming DMs, `peer = to` for outgoing, NULL for broadcasts.
3. **The UI only renders one conversation.** If the view is hard-wired to channel 0, DMs are stored but never shown. Check the DB directly: `SELECT count(*) FROM messages WHERE peer IS NOT NULL;`.
4. **Encrypted DMs not decoded.** On current firmware, DMs between nodes that know each other's public keys are PKI-encrypted; the node decrypts them and hands the client a decoded packet flagged `pki_encrypted`. Make sure the handler doesn't skip packets that carry that flag or that arrive with an unexpected channel value.
5. **Expectation check.** The node only receives DMs addressed **to it**. Other people's DMs on the mesh never appear, and that's correct.

Add a FakeNode fixture with incoming and outgoing DMs (PKI-flagged and legacy channel-encrypted) and a regression test proving they land in the DB with the right `peer` and render in the list.

## 2. Layout

```
┌──────────────────────┬──────────────────────────────────────────┐
│ [Search…]   [✎ New]  │ K7AB · Kevin's Base   🔒  seen 3m  [ⓘ]  │ ← conversation header
│ CHANNELS             ├──────────────────────────────────────────┤
│ # LongFast       3   │                          Today            │
│ # Augusta            │  ┌──────────────────────┐                 │
│ # Admin  🔇          │  │ Heading out now      │  10:02          │
│ DIRECT MESSAGES      │  └──────────────────────┘                 │
│ ● K7AB  Hey, you…  1 │                 ┌───────────────────┐     │
│ ○ RLY1  Thanks!      │        10:04    │ Copy, see you ✓✓  │     │
│ ○ BASE  ok           │                 └───────────────────┘     │
│                      ├──────────────────────────────────────────┤
│                      │ [↩ replying to "Heading out…" ✕]          │
│                      │ [Message K7AB…                 ] 34/200 ➤ │
└──────────────────────┴──────────────────────────────────────────┘
```

- **Desktop (≥ 768 px):** conversation list (320 px) + thread.
- **Mobile (< 768 px):** list is the screen; tapping a conversation pushes the thread full screen with a back button.
- Routes: `/messages`, `/messages/channel/:index`, `/messages/dm/:nodeId` (e.g. `/messages/dm/!a1b2c3d4`). Deep links from the dashboard, map popup and node drawer "Message" buttons go to the DM route.
- Last open conversation is remembered per browser.

## 3. Conversation list

**Channels section**

- One row per configured channel (index 0–7, skip `DISABLED`), in index order.
- Shows `#` + channel name (index 0 with an empty name shows the modem preset name, e.g. "LongFast"), unread count, mute icon.

**Direct messages section**

- One row per `peer` that has at least one message, sorted by latest message time.
- Shows status dot (online/recent/stale/offline), short name, long name, last message preview (one line, prefixed "You: " if outgoing), relative time, unread count.
- Lock icon when the last message was PKI-encrypted.

**Common**

- Bold row and count badge when unread. Count caps at "99+".
- Search filters both sections by name / short name / node ID and also searches message text (results shown as a separate "Messages" section).
- Right-click / long-press a row: Mark read, Mute, Favorite (pins DM to the top), Delete conversation (DMs only, local history only, with confirmation).
- Ignored nodes' DMs are hidden unless "Show ignored" is on.

**New DM (✎)**

- Opens a node picker: searchable list of known nodes (status dot, names, hops, last seen), favorites first.
- Picking a node opens `/messages/dm/:nodeId`, whether or not a thread exists yet.
- Warn in the picker when the node hasn't been heard for more than 24 h, or has no public key (DM will fall back to channel encryption).

## 4. Thread view

**Header**

- Channel: `#name`, channel role (Primary/Secondary), "Encrypted" or "Unencrypted" pill based on PSK, member count = nodes heard on that channel recently (if available).
- DM: status dot, names, node ID, lock icon (PKI) or open-lock warning (channel-encrypted fallback), last seen, hops; ⓘ opens the node drawer.

**Messages**

- Grouped by day with sticky date separators; consecutive messages from the same sender within 5 minutes are grouped.
- Incoming on the left, outgoing on the right (`data-mt-variant="incoming|outgoing"`); in channels, show the sender's short name and colored avatar chip (color derived from node number, via token palette `--mt-chart-1…6`).
- Per-message metadata on hover / tap: absolute time, hops (`hop_start - hop_limit`), SNR/RSSI if heard directly, "via MQTT" if `via_mqtt`.
- **Delivery status (outgoing):** queued (clock) → sent (✓) → acked (✓✓) → failed (⚠ with reason from `Routing.error_reason`, e.g. NO_RESPONSE, MAX_RETRANSMIT, NO_CHANNEL, PKI_FAILED). Failed messages get a "Retry" action. On channels, ✓✓ means an implicit ACK (a neighbor rebroadcast it), not that everyone received it; tooltip says so.
- **Replies:** shows a quoted snippet of the parent (`reply_id`); clicking it scrolls to the parent.
- **Reactions (tapbacks):** messages with `emoji` set and a `reply_id` render as reaction chips under the target message (count + who), not as separate bubbles. Clicking a chip shows names. Users can react via a hover/long-press menu with a small emoji palette; sending one is a packet with `emoji = 1`, `reply_id = target packet id`, payload = the emoji.
- Links are auto-linked (`rel="noopener noreferrer"`); no HTML is ever rendered from message text.
- Infinite scroll upward, 50 messages per page, keeping scroll position; "Jump to latest" button when scrolled up and new messages arrive.

**Composer**

- Multiline (Enter sends, Shift+Enter newline; on mobile the send button sends).
- Live UTF-8 **byte** counter, limit 200 bytes; counter turns warn at 180 and blocks send above 200.
- Reply mode bar with cancel.
- Drafts saved per conversation (localStorage, try/catch).
- Disabled with a reason when: disconnected, viewer role, or the channel is `DISABLED`/receive-only.
- Outgoing rate limit (from the main spec) shows a short "Slow down — airtime" notice rather than failing silently.

**Read state**

- A conversation is marked read when its thread is visible and scrolled to the bottom for 1 s while the tab is focused.
- Read state is stored server-side so it syncs across browsers.

## 5. Data model changes

`messages` (existing) — make sure these columns exist:

| Column                                        | Notes                                                       |
| --------------------------------------------- | ----------------------------------------------------------- |
| `peer`                                        | Other party's node num for DMs; NULL for channel broadcasts |
| `channel_index`                               | Channel the packet arrived on / was sent on                 |
| `pki_encrypted`                               | Boolean                                                     |
| `via_mqtt`                                    | Boolean                                                     |
| `reply_id`                                    | Parent packet id, nullable                                  |
| `emoji`                                       | Boolean/int; true means this row is a reaction              |
| `hop_start`, `hop_limit`, `rx_snr`, `rx_rssi` | For metadata display                                        |
| `status`, `error_reason`                      | Outgoing delivery state                                     |

Indexes: `(connection_id, peer, rx_time)`, `(connection_id, channel_index, rx_time) WHERE peer IS NULL`, unique `(connection_id, from_num, packet_id)` for dedupe.

New table:

```
conversation_state(connection_id, kind ('channel'|'dm'), key (channel index or peer num),
                   last_read_rx_time, muted, favorite, deleted_before,
                   PRIMARY KEY (connection_id, kind, key))
```

Unread count = messages in that conversation with `rx_time > last_read_rx_time`, excluding outgoing messages and reactions. "Delete conversation" sets `deleted_before = now` (messages older than that are hidden) instead of deleting rows.

Optional full-text search: SQLite FTS5 table over `messages.text`, kept in sync by triggers.

## 6. API and live updates

| Endpoint                                                            | Purpose                                                                                                                                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/connections/:id/conversations`                            | Channels + DMs with last message preview, unread count, muted/favorite. One call builds the whole list.                                                                       |
| `GET /api/connections/:id/messages?channel=:index&before=&limit=50` | Channel history page (excludes DMs)                                                                                                                                           |
| `GET /api/connections/:id/messages?peer=:num&before=&limit=50`      | DM history page                                                                                                                                                               |
| `POST /api/connections/:id/messages`                                | Body `{ text, channel?: number, to?: number, replyId?: number, emoji?: boolean }`. Exactly one of `channel` or `to`. DMs are sent with `want_ack = true`, destination = peer. |
| `POST /api/connections/:id/conversations/:kind/:key/read`           | Body `{ upTo: rxTime }`                                                                                                                                                       |
| `PATCH /api/connections/:id/conversations/:kind/:key`               | `{ muted?, favorite? }`                                                                                                                                                       |
| `DELETE /api/connections/:id/conversations/dm/:peer`                | Sets `deleted_before`                                                                                                                                                         |
| `GET /api/connections/:id/messages/search?q=`                       | FTS results with conversation context                                                                                                                                         |

WS events: existing `message.new` and `message.status`, plus `conversation.read` (so other open browsers clear their badges) and `conversation.updated`.

Client: TanStack Query infinite queries per conversation; `message.new` appends to the right thread's cache and bumps the conversation list entry.

## 7. Notifications

- New DM: browser notification + sound unless the DM is muted or the thread is open and focused.
- Channel messages: notify only on mention of my short or long name (case-insensitive word match), or if the user turned on "Notify all" for that channel.
- Tab title shows the total unread count, e.g. `(3) MeshTerm`. Favicon badge optional.
- Global unread badge on the Messages nav item.

## 8. Theming hooks

| Hook                                                            | States / variants  |
| --------------------------------------------------------------- | ------------------ |
| `data-mt="messages-view"`                                       |                    |
| `data-mt="conversation-list"`, `"conversation-section"`         | variant: `channels | dms                                     | search` |
| `data-mt="conversation-row"`                                    | variant: `channel  | dm`; state: `unread`, `active`, `muted` |
| `data-mt="unread-badge"`                                        |                    |
| `data-mt="thread"`, `"thread-header"`, `"day-separator"`        |                    |
| `data-mt="message-bubble"`                                      | variant: `incoming | outgoing`; state: `queued               | sent    | acked | failed`, `grouped` |
| `data-mt="message-meta"`, `"delivery-status"`                   | state as above     |
| `data-mt="reply-quote"`, `"reaction-chip"`, `"reaction-picker"` |                    |
| `data-mt="encryption-badge"`                                    | variant: `pki      | channel                                 | none`   |
| `data-mt="composer"`, `"byte-counter"`                          | state: `ok         | warn                                    | over`   |
| `data-mt="node-picker"`                                         |                    |

Retro Terminal theme renders bubbles as IRC-style log lines (`[10:04] <K7AB> text`) using these hooks, no special markup.

## 9. Acceptance criteria

- [ ] Incoming and outgoing DMs are stored with the correct `peer` and appear under Direct Messages
- [ ] All configured channels appear, each with its own history; DMs never appear in a channel thread
- [ ] New DM from the ✎ picker and from Message buttons elsewhere opens the right thread
- [ ] Unread counts per conversation, global nav badge and tab title; marking read syncs to another open browser
- [ ] Outgoing status moves queued → sent → acked, or failed with reason and Retry
- [ ] Replies show quoted parent; reactions render as chips, not bubbles, and can be sent
- [ ] 200-byte UTF-8 limit enforced with live counter (tested with emoji)
- [ ] PKI lock / fallback warning shown correctly in DM header
- [ ] Mobile list → thread navigation works at 390 px
- [ ] Viewer role can read but not send or react
- [ ] FakeNode fixtures: incoming DM, outgoing DM with ACK, failed DM with NAK reason, PKI and non-PKI DM, reply, reaction, message on a secondary channel, duplicate packet (deduped)
- [ ] Playwright screenshots of the Messages view in all built-in themes
