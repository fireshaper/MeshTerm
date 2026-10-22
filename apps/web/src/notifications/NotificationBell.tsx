import {
  DND_FOREVER,
  inQuietHours,
  type NotificationPrefsDTO,
  type NotificationPrefsPatch,
} from "@meshterm/shared";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, BellOff } from "lucide-react";
import { useNow } from "../components/useNow.js";
import { formatAgo } from "../dashboard/format.js";
import { ApiError, api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
import {
  groupOf,
  markAllEventsRead,
  openConversation,
  useNotifyCenter,
  type NotificationEvent,
} from "./center.js";
import { readConversation } from "./NotificationToasts.js";
import { useNotificationPrefs } from "./runtime.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/** Events in a row from the same conversation become one entry (CR-003 §6.3). */
export function groupEvents(events: readonly NotificationEvent[]) {
  const rows: { event: NotificationEvent; count: number; unread: boolean }[] = [];
  for (const e of events) {
    const last = rows.at(-1);
    if (last && e.target && last.event.target && groupOf(last.event.target) === groupOf(e.target)) {
      last.count += 1;
      last.unread ||= e.unread;
    } else {
      rows.push({ event: e, count: 1, unread: e.unread });
    }
  }
  return rows;
}

/** Tomorrow at 08:00 in this browser's time zone. */
export function tomorrowMorning(now: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

export function dndActive(prefs: NotificationPrefsDTO | undefined, now: number): boolean {
  return prefs?.dndUntil != null && prefs.dndUntil > now;
}

function dndLabel(until: number): string {
  if (until >= DND_FOREVER) return "Do Not Disturb is on";
  return `Do Not Disturb until ${new Date(until).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** The bell: recent notifications, Mark all read, Do Not Disturb (CR-003 §6.3, §4.2). */
export function NotificationBell() {
  const qc = useQueryClient();
  const now = useNow();
  const toast = useUiStore((s) => s.toast);
  const events = useNotifyCenter((s) => s.events);
  const open = useNotifyCenter((s) => s.bellOpen);
  const { data: prefs } = useNotificationPrefs();
  const unread = events.filter((e) => e.unread).length;
  const dnd = dndActive(prefs, now);
  const quietNow = prefs
    ? inQuietHours(prefs.quietHours, now, prefs.serverUtcOffsetMinutes)
    : false;
  const rows = groupEvents(events);

  const setOpen = (bellOpen: boolean) => {
    useNotifyCenter.setState({ bellOpen });
  };
  const fail = (err: unknown) => {
    toast(err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.", "error");
  };
  const savePrefs = (patch: NotificationPrefsPatch) => {
    api.updateNotificationPrefs(patch).then((next) => {
      qc.setQueryData(queryKeys.notificationPrefs, next);
    }, fail);
  };

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button
          type="button"
          data-mt="notification-bell"
          data-mt-state={dnd ? "dnd" : undefined}
          aria-label={
            (unread > 0 ? `Notifications, ${unread} unread` : "Notifications") +
            (dnd ? " (Do Not Disturb)" : "")
          }
        >
          {dnd ? <BellOff data-mt="icon" {...ICON} /> : <Bell data-mt="icon" {...ICON} />}
          {unread > 0 && (
            <span data-mt="nav-badge" aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
          {dnd && (
            <span data-mt="dnd-indicator" title={prefs?.dndUntil ? dndLabel(prefs.dndUntil) : ""}>
              DND
            </span>
          )}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-mt="notification-center" align="end" sideOffset={6}>
          <div data-mt="notification-center-header">
            <Menu.Label data-mt="menu-label">Notifications</Menu.Label>
            <Menu.Item
              data-mt="menu-item"
              disabled={unread === 0}
              onSelect={() => {
                for (const target of markAllEventsRead()) {
                  api.markRead(target.connectionId, target.kind, target.key).catch(fail);
                }
              }}
            >
              Mark all read
            </Menu.Item>
          </div>
          {rows.length === 0 ? (
            <p data-mt="notification-center-empty">No notifications yet.</p>
          ) : (
            <div data-mt="notification-list">
              {rows.map(({ event, count, unread: isUnread }) => (
                <Menu.Item
                  key={event.id}
                  data-mt="notification-item"
                  data-mt-state={isUnread ? "unread" : undefined}
                  data-mt-variant={event.variant}
                  onSelect={() => {
                    openConversation(event.target);
                    if (event.target) void readConversation(event.target).catch(fail);
                  }}
                >
                  {isUnread && <span data-mt="notification-dot" aria-label="Unread" />}
                  <span data-mt="notification-title">
                    {event.title}
                    {count > 1 && <span data-mt="notification-count"> ({count})</span>}
                  </span>
                  <span data-mt="notification-preview">
                    {event.kind === "backlog"
                      ? "Open Messages to catch up."
                      : event.variant === "reaction"
                        ? `Reacted ${event.message?.text ?? ""}`
                        : event.message?.text}
                  </span>
                  <time data-mt="notification-time" dateTime={new Date(event.at).toISOString()}>
                    {formatAgo(event.at, Math.max(now, event.at))}
                  </time>
                </Menu.Item>
              ))}
            </div>
          )}
          <Menu.Separator data-mt="menu-separator" />
          {dnd && prefs?.dndUntil ? (
            <>
              <Menu.Label data-mt="menu-label">{dndLabel(prefs.dndUntil)}</Menu.Label>
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  savePrefs({ dndUntil: null });
                }}
              >
                Turn off Do Not Disturb
              </Menu.Item>
            </>
          ) : (
            <>
              <Menu.Label data-mt="menu-label">Do Not Disturb</Menu.Label>
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  savePrefs({ dndUntil: Date.now() + 3600_000 });
                }}
              >
                For 1 hour
              </Menu.Item>
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  savePrefs({ dndUntil: tomorrowMorning(Date.now()) });
                }}
              >
                Until tomorrow
              </Menu.Item>
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  savePrefs({ dndUntil: DND_FOREVER });
                }}
              >
                Until I turn it off
              </Menu.Item>
            </>
          )}
          {prefs?.quietHours && (
            <Menu.Label data-mt="menu-label">
              Quiet hours {prefs.quietHours.start}–{prefs.quietHours.end}
              {quietNow ? " (now)" : ""}
            </Menu.Label>
          )}
          <Menu.Item data-mt="menu-item" asChild>
            <Link to="/settings/notifications">Notification settings</Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
