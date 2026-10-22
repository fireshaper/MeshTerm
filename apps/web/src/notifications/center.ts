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
import { decide, isQuiet, type Alert, type ViewContext } from "./rules.js";
import { useBrowserNotifySettings } from "./settings.js";

/** One alert-worthy message (or a reconnect summary), for toasts and the bell (N3). */
export interface NotificationEvent {
  id: string;
  at: number;
  kind: "message" | "backlog";
  message?: Message;
  hint?: NotifyHint;
  backlog?: Omit<ServerMessageOf<"notifications.backlog">, "type">;
  alert: Alert;
  /** "K7AB" or "#LongFast · K7AB". */
  title: string;
}

interface CenterState {
  /** The conversation open and scrolled to the bottom, if any (set by the message list). */
  viewing: ViewContext["viewing"];
  setViewing: (viewing: ViewContext["viewing"]) => void;
  /** The title flashes this while the tab is hidden (CR-003 §5). */
  flash: string | null;
  setFlash: (flash: string | null) => void;
  events: NotificationEvent[];
}

/** Events kept for the bell (CR-003 §6.3). */
export const MAX_EVENTS = 50;

export const useNotifyCenter = create<CenterState>()((set) => ({
  viewing: null,
  setViewing: (viewing) => {
    set({ viewing });
  },
  flash: null,
  setFlash: (flash) => {
    set({ flash });
  },
  events: [],
}));

export function resetNotifyCenter(): void {
  useNotifyCenter.setState({ viewing: null, flash: null, events: [] });
}

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

function view(): ViewContext {
  return {
    viewing: useNotifyCenter.getState().viewing,
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
  };
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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

let seq = 0;
const nextId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

function push(event: NotificationEvent): void {
  useNotifyCenter.setState((s) => ({ events: [event, ...s.events].slice(0, MAX_EVENTS) }));
}

/** \`message.new\` with the server's hint: decide, then record and alert. */
export function handleMessageNew(
  qc: QueryClient,
  message: Message,
  hint: NotifyHint | undefined,
): void {
  const prefs = qc.getQueryData<NotificationPrefsDTO>(queryKeys.notificationPrefs);
  const { settings } = useBrowserNotifySettings.getState();
  const alert = decide(message, hint, prefs, settings, view(), Date.now());
  if (!alert.toast && !alert.flash && !alert.os && alert.sound === null) return;
  const sender = senderName(qc, message);
  push({
    id: nextId(),
    at: Date.now(),
    kind: "message",
    message,
    ...(hint ? { hint } : {}),
    alert,
    title: message.peer === null ? `#${channelName(qc, message)} · ${sender}` : sender,
  });
  if (alert.flash && isLeaderTab()) {
    useNotifyCenter
      .getState()
      .setFlash(flashText(sender, message.emoji ? `reacted ${message.text}` : message.text));
  }
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
  push({ id: nextId(), at: Date.now(), kind: "backlog", backlog, alert, title });
  if (alert.flash && isLeaderTab()) useNotifyCenter.getState().setFlash(`💬 ${title}`);
}
