import type { Conversation } from "../data/keys.js";
import { useLiveStore } from "../data/store.js";
import { Composer } from "./Composer.js";
import { MessageList } from "./MessageList.js";

/** A channel or DM conversation: its message list and composer. */
export function ConversationView({ conversation }: { conversation: Conversation }) {
  const connectionId = useLiveStore((s) => s.connectionId);
  if (connectionId === null) {
    return <p data-mt="conversation-waiting">Connecting…</p>;
  }
  return (
    <div data-mt="conversation" data-mt-variant={"channel" in conversation ? "channel" : "dm"}>
      <MessageList connectionId={connectionId} conversation={conversation} />
      <Composer connectionId={connectionId} conversation={conversation} />
    </div>
  );
}
