import { MAX_TEXT_BYTES, utf8ByteLength } from "@meshterm/shared";
import { Check, Reply, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useIsAdmin } from "../auth/me.js";
import { useNow } from "../components/useNow.js";
import { formatAgo } from "../dashboard/format.js";
import { ApiError, api } from "../data/api.js";
import { useUiStore } from "../data/ui-store.js";
import {
  dismissToast,
  markConversationRead,
  openConversation,
  useNotifyCenter,
  type ConversationTarget,
  type NotificationEvent,
  type ToastItem,
} from "./center.js";
import { useBrowserNotifySettings } from "./settings.js";

const ICON = { "aria-hidden": true, focusable: false } as const;
/** At most this many toasts show; the rest collapse into "+N more" (CR-003 §6.1). */
export const MAX_TOASTS = 3;
/** How long a toast stays (DMs a little longer); hover or focus pauses it. */
export const TOAST_MS = 6_000;
export const DM_TOAST_MS = 10_000;

/** Marks a conversation read on the server and here at once. */
export async function readConversation(target: ConversationTarget): Promise<void> {
  markConversationRead(target);
  await api.markRead(target.connectionId, target.kind, target.key);
}

/** The toast stack (CR-003 §6.1). Lives in the app shell, below the header. */
export function NotificationToasts() {
  const toasts = useNotifyCenter((s) => s.toasts);
  const events = useNotifyCenter((s) => s.events);
  const position = useBrowserNotifySettings((s) => s.settings.toastPosition);
  const shown = toasts.slice(0, MAX_TOASTS);
  const more = toasts.length - shown.length;
  return (
    <section data-mt="toast-region" data-mt-variant={position} aria-label="Notifications">
      {shown.map((t) => {
        const event = events.find((e) => e.id === t.eventId);
        return event ? <Toast key={t.id} toast={t} event={event} /> : null;
      })}
      {more > 0 && (
        <button
          type="button"
          data-mt="toast-more"
          onClick={() => {
            useNotifyCenter.setState({ bellOpen: true });
          }}
        >
          +{more} more
        </button>
      )}
    </section>
  );
}

function headline(toast: ToastItem, event: NotificationEvent): string {
  if (event.kind === "backlog") return event.title;
  if (toast.variant === "reaction") return `${event.title} reacted ${event.message?.text ?? ""}`;
  return event.target?.kind === "dm" ? `${event.title} · Direct message` : event.title;
}

function body(toast: ToastItem, event: NotificationEvent): string {
  if (event.kind === "backlog") return "Open Messages to catch up.";
  const text = event.message?.text.replace(/\s+/g, " ").trim() ?? "";
  if (toast.count > 1 && event.target?.kind === "dm") {
    return `${toast.count} new messages from ${event.title}: ${text}`;
  }
  return toast.count > 1 ? `${toast.count} new messages · ${text}` : text;
}

function Toast({ toast, event }: { toast: ToastItem; event: NotificationEvent }) {
  const now = useNow();
  const admin = useIsAdmin();
  const notify = useUiStore((s) => s.toast);
  const [paused, setPaused] = useState(false);
  const [replying, setReplying] = useState(false);
  const [sent, setSent] = useState(false);
  const life = event.target?.kind === "dm" ? DM_TOAST_MS : TOAST_MS;
  const left = useRef(life);

  // Restart the clock when the toast is updated (grouped); pause while hovered or focused.
  useEffect(() => {
    left.current = life;
  }, [toast.updatedAt, life]);
  useEffect(() => {
    if (paused || replying) return;
    const started = Date.now();
    const timer = setTimeout(() => {
      dismissToast(toast.id);
    }, left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(1_000, left.current - (Date.now() - started));
    };
  }, [paused, replying, toast.id, toast.updatedAt]);

  const open = () => {
    dismissToast(toast.id);
    openConversation(event.target);
    if (event.target) void readConversation(event.target).catch(() => undefined);
  };

  const canReply =
    admin && event.target !== null && toast.variant !== "reaction" && event.kind === "message";

  return (
    <article
      data-mt="toast"
      data-mt-variant={toast.variant}
      data-mt-state={toast.count > 1 ? "grouped" : undefined}
      role={toast.priority ? "alert" : "status"}
      aria-label={headline(toast, event)}
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      <button type="button" data-mt="toast-open" onClick={open}>
        <span data-mt="toast-title">
          <span data-mt="toast-dot" aria-hidden />
          {headline(toast, event)}
        </span>
        <span data-mt="toast-body">{body(toast, event)}</span>
      </button>
      <button
        type="button"
        data-mt="icon-button"
        aria-label="Dismiss"
        onClick={() => {
          dismissToast(toast.id);
        }}
      >
        <X data-mt="icon" {...ICON} />
      </button>
      {replying && event.target ? (
        <ToastReply
          target={event.target}
          onDone={(ok) => {
            setReplying(false);
            if (ok) {
              setSent(true);
              setTimeout(() => {
                dismissToast(toast.id);
              }, 1_500);
            }
          }}
        />
      ) : (
        <div data-mt="toast-actions">
          {sent ? (
            <span data-mt="toast-sent">
              Sent <Check data-mt="icon" {...ICON} />
            </span>
          ) : (
            <>
              {canReply && (
                <button
                  type="button"
                  data-mt="button"
                  onClick={() => {
                    setReplying(true);
                  }}
                >
                  <Reply data-mt="icon" {...ICON} /> Reply
                </button>
              )}
              {event.target && (
                <button
                  type="button"
                  data-mt="button"
                  onClick={() => {
                    dismissToast(toast.id);
                    if (event.target) {
                      void readConversation(event.target).catch(() => {
                        notify("Couldn't mark it read. Try again.", "error");
                      });
                    }
                  }}
                >
                  Mark read
                </button>
              )}
            </>
          )}
          <time data-mt="toast-time" dateTime={new Date(event.at).toISOString()}>
            {formatAgo(event.at, Math.max(now, event.at))}
          </time>
        </div>
      )}
    </article>
  );
}

/** One line, the same 200-byte limit as the composer; Enter sends (CR-003 §6.1). */
function ToastReply({
  target,
  onDone,
}: {
  target: ConversationTarget;
  onDone: (sent: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bytes = utf8ByteLength(text);
  const tooLong = bytes > MAX_TEXT_BYTES;
  const inputId = `toast-reply-${target.kind}-${target.key}`;

  async function send() {
    if (!text.trim() || tooLong || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.send(
        target.connectionId,
        text.trim(),
        target.kind === "channel" ? { channel: target.key } : { peer: target.key },
      );
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send. Try again.");
      setBusy(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      onDone(false);
    }
  };

  return (
    <div data-mt="toast-reply">
      <input
        id={inputId}
        aria-label="Reply"
        aria-invalid={tooLong || undefined}
        aria-describedby={`${inputId}-counter`}
        // A reply box the user just opened: focusing it is the expected next step.
        autoFocus
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={onKey}
      />
      <span
        id={`${inputId}-counter`}
        data-mt="byte-counter"
        data-mt-state={tooLong ? "over" : bytes > 180 ? "warn" : "ok"}
      >
        {bytes}/{MAX_TEXT_BYTES}
      </span>
      {error && (
        <small data-mt="config-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
