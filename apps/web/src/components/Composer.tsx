import { MAX_TEXT_BYTES, utf8ByteLength } from "@meshterm/shared";
import { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { ApiError, api } from "../data/api.js";
import type { Conversation } from "../data/keys.js";
import { useLiveStore } from "../data/store.js";

export function sendErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409)
      return "The node isn't connected right now. Try again once it reconnects.";
    if (err.status === 429) return "You're sending too fast. Wait a moment and try again.";
    return err.message;
  }
  return "Couldn't reach the server. Check your connection and try again.";
}

interface ComposerProps {
  connectionId: number;
  conversation: Conversation;
}

/**
 * Text input with a live UTF-8 byte counter. Enter sends, Shift+Enter adds a line.
 * The sent message shows up through the live `message.new`, not optimistically.
 */
export function Composer({ connectionId, conversation }: ComposerProps) {
  const nodeState = useLiveStore((s) => s.nodeState);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bytes = utf8ByteLength(text);
  const tooLong = bytes > MAX_TEXT_BYTES;
  const empty = text.trim().length === 0;
  const connected = nodeState === "connected";
  const canSend = connected && !empty && !tooLong && !sending;
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
      <textarea
        data-mt="composer-input"
        aria-label="Message"
        placeholder={connected ? "Message" : "Waiting for the node…"}
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
      <span
        id="composer-counter"
        data-mt="byte-counter"
        data-mt-state={tooLong ? "over" : "ok"}
        aria-live="polite"
      >
        {bytes}/{MAX_TEXT_BYTES}
      </span>
      <button type="submit" data-mt="send-button" disabled={!canSend}>
        Send
      </button>
      {error && (
        <p data-mt="composer-error" role="alert">
          {error}
        </p>
      )}
      {!connected && (
        <p data-mt="composer-hint">Sending is off while the node is {nodeState ?? "unknown"}.</p>
      )}
    </form>
  );
}
