import { MAX_TEXT_BYTES, utf8ByteLength } from "@meshterm/shared";
import { SendHorizontal } from "lucide-react";
import { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { ApiError, api } from "../data/api.js";
import type { Conversation } from "../data/keys.js";
import { useLiveStore } from "../data/store.js";
import { useIsAdmin, VIEWER_HINT } from "../auth/me.js";
import { byteMeterState } from "../messages/thread.js";

export function sendErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409)
      return "The node isn't connected right now. Try again once it reconnects.";
    if (err.status === 429) return "You're sending too fast. Wait a moment and try again.";
    return err.message;
  }
  return "Couldn't reach the server. Check your connection and try again.";
}

/** Where a message goes: "CH 0 · LongFast" / "DM · TRL", and the name for the placeholder. */
export interface Destination {
  label: string;
  name: string;
}

interface ComposerProps {
  connectionId: number;
  conversation: Conversation;
  destination?: Destination | undefined;
}

/**
 * A field that grows with its text, a round send button, and under them the destination
 * and a byte meter (warns past 170 bytes, blocks past 200). Enter sends, Shift+Enter adds
 * a line. The sent message shows up through the live `message.new`, not optimistically.
 */
export function Composer({ connectionId, conversation, destination }: ComposerProps) {
  const nodeState = useLiveStore((s) => s.nodeState);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bytes = utf8ByteLength(text);
  const meter = byteMeterState(bytes);
  const tooLong = meter === "over";
  const empty = text.trim().length === 0;
  const connected = nodeState === "connected";
  const admin = useIsAdmin();
  const canSend = admin && connected && !empty && !tooLong && !sending;
  const state = sending ? "sending" : error ? "error" : canSend ? "ready" : "disabled";

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await api.send(connectionId, text, conversation);
      setText("");
    } catch (err) {
      setError(sendErrorText(err));
    } finally {
      setSending(false);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  return (
    <form data-mt="composer" data-mt-state={state} onSubmit={onSubmit}>
      <div data-mt="composer-row">
        <textarea
          data-mt="composer-input"
          aria-label="Message"
          placeholder={
            !admin
              ? "Viewers can't send messages"
              : connected
                ? destination
                  ? `Message ${destination.name}`
                  : "Message"
                : "Waiting for the node…"
          }
          readOnly={!admin}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          aria-invalid={tooLong}
          aria-describedby="composer-counter"
        />
        <button type="submit" data-mt="send-button" disabled={!canSend} aria-label="Send">
          <SendHorizontal data-mt="icon" aria-hidden focusable={false} />
          <span data-mt="send-button-label">Send</span>
        </button>
      </div>
      <div data-mt="composer-foot">
        {destination && <span data-mt="composer-destination">{destination.label}</span>}
        <span
          data-mt="byte-meter"
          data-mt-state={meter}
          aria-hidden
          style={{ "--mt-byte-fill": String(Math.min(bytes / MAX_TEXT_BYTES, 1)) }}
        >
          <span data-mt="byte-meter-fill" />
        </span>
        <span id="composer-counter" data-mt="byte-counter" data-mt-state={meter} aria-live="polite">
          {bytes}/{MAX_TEXT_BYTES} bytes
        </span>
      </div>
      {error && (
        <p data-mt="composer-error" role="alert">
          {error}
        </p>
      )}
      {!admin ? (
        <p data-mt="composer-hint" data-mt-variant="viewer">
          {VIEWER_HINT}
        </p>
      ) : (
        !connected && (
          <p data-mt="composer-hint">Sending is off while the node is {nodeState ?? "unknown"}.</p>
        )
      )}
    </form>
  );
}
