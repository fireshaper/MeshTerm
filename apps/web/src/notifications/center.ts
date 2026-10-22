import {
  nodeIdFromNum,
  type MeshNode,
  type Message,
  type NotificationPrefsDTO,
  type NotifyHint,
  type ServerMessageOf,
} from "@meshterm/shared";
import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { queryKeys } from "../data/keys.js";
import { TabLeader } from "./leader.js";
import { decide, isQuiet, SILENT, type Alert, type ViewContext } from "./rules.js";
import { useBrowserNotifySettings } from "./settings.js";

export type ConversationTarget = { connectionId: number; kind: "channel" | "dm"; key: number };

/** Toast variants (CR-003 §12). */
export type ToastVariant = "dm" | "mention" | "channel" | "reaction" | "backlog" | "system";

/** One notification for the bell (CR-003 §6.3): a message, or a reconnect summary. */
export interface NotificationEvent {
  id: string;
  at: number;
  kind: "message" | "backlog";
  variant: ToastVariant;
  message?: Message;
  hint?: NotifyHint;
  backlog?: Omit<ServerMessageOf<"notifications.backlog">, "type">;
  alert: Alert;
  /** "K7AB" or "#LongFast · K7AB", or the summary. */
  title: string;
  /** The conversation it belongs to (none for a summary). */
  target: ConversationTarget | null;
  /** Its conversation hasn't been read since. */
  unread: boolean;
}

/** A visible toast: one per conversation, grouping messages within 10 s (CR-003 §6.1). */
export interface ToastItem {
  id: string;
  /** `connectionId:kind:key`, or the summary's own id. */
  group: string;
  variant: ToastVariant;
  /** The newest event shown. */
  eventId: string;
  count: number;
  createdAt: number;
  updatedAt: number;
  priority: boolean;
}

interface CenterState {
  /** The conversation open and scrolled to the bottom, if any (set by the message list). */
  viewing: ViewContext["viewing"];
  setViewing: (viewing: ViewContext["viewing"]) => void;
  /** The title flashes this while the tab is hidden (CR-003 §5). */
  flash: string | null;
  setFlash: (flash: string | null) => void;
  /** Newest first, at most 50 (kept in sessionStorage). */
  events: NotificationEvent[];
  /** Newest first. */
  toasts: ToastItem[];
  /** The bell's list is open ("+N more" opens it). */
  bellOpen: boolean;
}

/** Events kept for the bell (CR-003 §6.3). */
export const MAX_EVENTS = 50;
/** Further messages of a conversation within this long update its toast. */
export const GROUP_MS = 10_000;
export const EVENTS_KEY = "meshterm.notifications.events";

function readEvents(): NotificationEvent[] {
  try {
    const raw = sessionStorage.getItem(EVENTS_KEY);
    return raw ? (JSON.parse(raw) as NotificationEvent[]).slice(0, MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

function saveEvents(events: NotificationEvent[]): void {
  try {
    sessionStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch {
    // Not kept across reloads; still shown.
  }
}

export const useNotifyCenter = create<CenterState>()((set) => ({
  viewing: null,
  setViewing: (viewing) => {
    set({ viewing });
  },
  flash: null,
  setFlash: (flash) => {
    set({ flash });
  },
  events: readEvents(),
  toasts: [],
  bellOpen: false,
}));

export function resetNotifyCenter(): void {
  useNotifyCenter.setState({ viewing: null, flash: null, events: [], toasts: [], bellOpen: false });
  try {
    sessionStorage.removeItem(EVENTS_KEY);
  } catch {
    // Nothing stored.
  }
}

function setEvents(change: (events: NotificationEvent[]) => NotificationEvent[]): void {
  const events = change(useNotifyCenter.getState().events).slice(0, MAX_EVENTS);
  useNotifyCenter.setState({ events });
  saveEvents(events);
}

// ------------------------------------------------------------------- the leader tab

let leader: TabLeader | null = null;

/** Starts this tab's part in the election (once, from the app shell). */
export function startLeader(): () => void {
  leader ??= new TabLeader();
  leader.start();
  const announce = () => {
    leader?.announce();
  };
  window.addEventListener("focus", announce);
  window.addEventListener("blur", announce);
  return () => {
    window.removeEventListener("focus", announce);
    window.removeEventListener("blur", announce);
    leader?.stop();
    leader = null;
  };
}

/** Whether this tab plays sounds, flashes and shows OS notifications. */
export const isLeaderTab = (): boolean => leader?.isLeader ?? true;

// ----------------------------------------------------------- outlets (sound, OS, open)

type AlertListener = (event: NotificationEvent) => void;
const alertListeners = new Set<AlertListener>();
type ReadListener = (target: ConversationTarget) => void;
const readListeners = new Set<ReadListener>();

/** Called for every new event in the leader tab (sounds and OS notifications, N4). */
export function onLeaderAlert(listener: AlertListener): () => void {
  alertListeners.add(listener);
  return () => alertListeners.delete(listener);
}

/** Called when a conversation is read anywhere (closes its OS notification). */
export function onConversationRead(listener: ReadListener): () => void {
  readListeners.add(listener);
  return () => readListeners.delete(listener);
}

type Opener = (target: ConversationTarget | null) => void;
let opener: Opener | null = null;

/** The app shell registers how to open a conversation (the router lives there). */
export function registerOpener(open: Opener | null): void {
  opener = open;
}

/** Opens a conversation; null opens Messages. */
export function openConversation(target: ConversationTarget | null): void {
  opener?.(target);
}

// ------------------------------------------------------------------------- helpers

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function view(): ViewContext {
  return {
    viewing: useNotifyCenter.getState().viewing,
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
  };
}

function senderName(qc: QueryClient, m: Message): string {
  const nodes = qc.getQueryData<MeshNode[]>(queryKeys.nodes(m.connectionId)) ?? [];
  const node = nodes.find((n) => n.num === m.fromNum);
  return node?.shortName || nodeIdFromNum(m.fromNum).slice(-4);
}

function channelName(qc: QueryClient, m: Message): string {
  const list = qc.getQueryData<{ channels: { index: number; name: string }[] }>(
    queryKeys.conversations(m.connectionId),
  );
  return (
    list?.channels.find((c) => c.index === m.channelIndex)?.name ?? `Channel ${m.channelIndex}`
  );
}

/** What the title flashes: "💬 K7AB: Heading out…" (40 characters at most). */
export function flashText(sender: string, text: string): string {
  return truncate(`💬 ${sender}: ${text.replace(/\s+/g, " ").trim()}`, 40);
}

export const targetOf = (m: Message): ConversationTarget =>
  m.peer === null
    ? { connectionId: m.connectionId, kind: "channel", key: m.channelIndex }
    : { connectionId: m.connectionId, kind: "dm", key: m.peer };

export const groupOf = (t: ConversationTarget) => `${t.connectionId}:${t.kind}:${t.key}`;

const sameTarget = (a: ConversationTarget | null, b: ConversationTarget) =>
  a !== null && a.connectionId === b.connectionId && a.kind === b.kind && a.key === b.key;

const VARIANTS: Record<NonNullable<NotifyHint["reason"]>, ToastVariant> = {
  dm: "dm",
  mention: "mention",
  reply: "mention",
  "channel-all": "channel",
  reaction: "reaction",
};

let seq = 0;
const nextId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Adds a toast for an event, or folds it into its conversation's recent toast. */
function showToast(event: NotificationEvent, group: string, now: number): void {
  useNotifyCenter.setState((s) => {
    const existing = s.toasts.find((t) => t.group === group && now - t.updatedAt < GROUP_MS);
    if (existing) {
      const updated: ToastItem = {
        ...existing,
        eventId: event.id,
        count: existing.count + 1,
        updatedAt: now,
        priority: existing.priority || event.alert.priority,
        // A mention outranks plain channel chatter in the same toast.
        variant: event.variant === "mention" ? "mention" : existing.variant,
      };
      return { toasts: [updated, ...s.toasts.filter((t) => t.id !== existing.id)] };
    }
    const toast: ToastItem = {
      id: nextId(),
      group,
      variant: event.variant,
      eventId: event.id,
      count: 1,
      createdAt: now,
      updatedAt: now,
      priority: event.alert.priority,
    };
    return { toasts: [toast, ...s.toasts] };
  });
}

export function dismissToast(id: string): void {
  useNotifyCenter.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

function alertOutlets(event: NotificationEvent): void {
  if (!isLeaderTab()) return;
  for (const listener of alertListeners) {
    try {
      listener(event);
    } catch {
      // A failing outlet (blocked audio, denied notification) never breaks the rest.
    }
  }
}

// ------------------------------------------------------------------------ handlers

/**
 * \`message.new\` with the server's hint: anything that would notify goes to the bell
 * (even during DND, CR-003 §4.2); toasts, flash, sound and OS follow \`decide\`.
 */
export function handleMessageNew(
  qc: QueryClient,
  message: Message,
  hint: NotifyHint | undefined,
): void {
  if (!hint || hint.level !== "notify" || !hint.reason) return;
  const target = targetOf(message);
  const v = view();
  const reading = v.visible && v.focused && v.viewing !== null && sameTarget(v.viewing, target);
  if (reading) return;
  const prefs = qc.getQueryData<NotificationPrefsDTO>(queryKeys.notificationPrefs);
  const { settings } = useBrowserNotifySettings.getState();
  const now = Date.now();
  const alert = decide(message, hint, prefs, settings, v, now);
  const sender = senderName(qc, message);
  const event: NotificationEvent = {
    id: nextId(),
    at: now,
    kind: "message",
    variant: VARIANTS[hint.reason],
    message,
    hint,
    alert,
    title: message.peer === null ? `#${channelName(qc, message)} · ${sender}` : sender,
    target,
    unread: true,
  };
  setEvents((events) => [event, ...events]);
  if (alert === SILENT) return;
  if (alert.toast) showToast(event, groupOf(target), now);
  if (alert.flash && isLeaderTab()) {
    useNotifyCenter
      .getState()
      .setFlash(flashText(sender, message.emoji ? `reacted ${message.text}` : message.text));
  }
  alertOutlets(event);
}

/** One summary for the burst after a reconnect (CR-003 §4.3). */
export function handleBacklog(
  qc: QueryClient,
  backlog: Omit<ServerMessageOf<"notifications.backlog">, "type">,
): void {
  const prefs = qc.getQueryData<NotificationPrefsDTO>(queryKeys.notificationPrefs);
  const quiet = isQuiet(prefs, Date.now(), backlog.dmCount > 0);
  const { settings } = useBrowserNotifySettings.getState();
  const away = document.visibilityState !== "visible" || !document.hasFocus();
  const alert: Alert = {
    toast: !quiet && settings.toasts,
    // A sound only when DMs are among them, and only one.
    sound:
      !quiet && settings.sounds && backlog.dmCount > 0 && settings.soundTypes.message
        ? "message"
        : null,
    os: !quiet && settings.desktop && away,
    flash: !quiet && settings.titleFlash && document.visibilityState !== "visible",
    priority: backlog.dmCount > 0,
  };
  const title = `${backlog.count} ${backlog.count === 1 ? "message" : "messages"} arrived while disconnected${
    backlog.dmCount > 0 ? ` (${backlog.dmCount} ${backlog.dmCount === 1 ? "DM" : "DMs"})` : ""
  }`;
  const now = Date.now();
  const event: NotificationEvent = {
    id: nextId(),
    at: now,
    kind: "backlog",
    variant: "backlog",
    backlog,
    alert,
    title,
    target: null,
    unread: true,
  };
  setEvents((events) => [event, ...events]);
  if (alert.toast) showToast(event, event.id, now);
  if (alert.flash && isLeaderTab()) useNotifyCenter.getState().setFlash(`💬 ${title}`);
  if (!quiet) alertOutlets(event);
}

/**
 * A conversation was read (here or in another browser, \`conversation.read\`): its
 * events are read, its toasts go, and its OS notification closes (CR-003 §9).
 */
export function markConversationRead(target: ConversationTarget): void {
  setEvents((events) =>
    events.map((e) => (e.unread && sameTarget(e.target, target) ? { ...e, unread: false } : e)),
  );
  const group = groupOf(target);
  useNotifyCenter.setState((s) => ({ toasts: s.toasts.filter((t) => t.group !== group) }));
  for (const listener of readListeners) listener(target);
}

/** "Mark all read": every event read; returns the conversations to mark read on the server. */
export function markAllEventsRead(): ConversationTarget[] {
  const targets = new Map<string, ConversationTarget>();
  for (const e of useNotifyCenter.getState().events) {
    if (e.unread && e.target) targets.set(groupOf(e.target), e.target);
  }
  setEvents((events) => events.map((e) => (e.unread ? { ...e, unread: false } : e)));
  useNotifyCenter.setState({ toasts: [] });
  return [...targets.values()];
}
