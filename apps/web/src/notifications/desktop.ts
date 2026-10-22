import { groupOf, openConversation, type NotificationEvent } from "./center.js";

/**
 * OS notifications (CR-003 §8). Only in a secure context (HTTPS or localhost), only
 * after the user allowed them, only when the tab isn't focused (the rules decide), and
 * one per conversation: a new message replaces it (same `tag`, `renotify`).
 */

export type DesktopSupport =
  | { state: "unsupported" }
  /** Plain http:// on a LAN address: browsers don't allow it. */
  | { state: "insecure" }
  | { state: "ready"; permission: NotificationPermission };

export function desktopSupport(): DesktopSupport {
  if (typeof window === "undefined" || !("Notification" in window)) return { state: "unsupported" };
  if (!window.isSecureContext) return { state: "insecure" };
  return { state: "ready", permission: Notification.permission };
}

/** Asks for permission (only from a user action); true when granted. */
export async function requestDesktopPermission(): Promise<boolean> {
  const support = desktopSupport();
  if (support.state !== "ready") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Title and body as CR-003 §8 describes them (60-character preview). */
export function desktopContent(
  event: NotificationEvent,
  longName: string | null,
  hideText: boolean,
): { title: string; body: string } {
  if (event.kind === "backlog") return { title: "MeshTerm", body: event.title };
  const dm = event.target?.kind === "dm";
  const title =
    dm && longName && longName !== event.title ? `${event.title} (${longName})` : event.title;
  if (hideText) {
    return {
      title: dm ? "MeshTerm" : (event.title.split(" · ")[0] ?? "MeshTerm"),
      body: dm ? "New direct message" : event.variant === "mention" ? "New mention" : "New message",
    };
  }
  const text = event.message?.text.replace(/\s+/g, " ").trim() ?? "";
  const body = event.variant === "reaction" ? `Reacted ${text}` : text;
  return { title, body: truncate(body, 60) };
}

const open = new Map<string, Notification>();

/** Shows an OS notification for an event; returns it (or null when not allowed). */
export function showDesktopNotification(
  event: NotificationEvent,
  longName: string | null,
  hideText: boolean,
): Notification | null {
  const support = desktopSupport();
  if (support.state !== "ready" || support.permission !== "granted") return null;
  const { title, body } = desktopContent(event, longName, hideText);
  const tag = event.target ? groupOf(event.target) : `backlog:${event.id}`;
  let n: Notification;
  try {
    n = new Notification(title, {
      body,
      tag,
      icon: "/favicon.svg",
      // Not in every TypeScript DOM lib yet; browsers that know it re-alert on the same tag.
      ...({ renotify: true } as object),
    });
  } catch {
    // Some browsers (Android Chrome) only allow notifications from a service worker.
    return null;
  }
  n.onclick = () => {
    window.focus();
    openConversation(event.target);
    n.close();
  };
  n.onclose = () => {
    if (open.get(tag) === n) open.delete(tag);
  };
  open.get(tag)?.close();
  open.set(tag, n);
  return n;
}

/** Closes a conversation's notification (it was read somewhere, CR-003 §9). */
export function closeDesktopNotification(tag: string): void {
  open.get(tag)?.close();
  open.delete(tag);
}
