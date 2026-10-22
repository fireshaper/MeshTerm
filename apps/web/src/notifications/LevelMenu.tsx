import type { ConversationKind, ConversationsDTO, NotifyLevel } from "@meshterm/shared";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useIsAdmin } from "../auth/me.js";
import { ApiError, api } from "../data/api.js";
import { applyStateToConversations } from "../data/conversations-cache.js";
import { queryKeys } from "../data/keys.js";
import { useConversationList } from "../data/queries.js";
import { useUiStore } from "../data/ui-store.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/** The three choices per kind (CR-003 §4): All, Mentions, None (= Mute). */
export function levelChoices(kind: ConversationKind): { level: NotifyLevel; label: string }[] {
  return kind === "channel"
    ? [
        { level: "all", label: "All messages" },
        { level: "mentions", label: "Mentions only (default)" },
        { level: "none", label: "Nothing (muted)" },
      ]
    : [
        { level: "dm-default", label: "All messages (default)" },
        { level: "mentions", label: "Mentions only" },
        { level: "none", label: "Nothing (muted)" },
      ];
}

/** The conversation's level, from the list (the kind's default until loaded). */
export function useConversationLevel(
  connectionId: number | null,
  kind: ConversationKind,
  key: number,
): NotifyLevel {
  const { data } = useConversationList(connectionId);
  const row =
    kind === "channel"
      ? data?.channels.find((c) => c.index === key)
      : data?.dms.find((d) => d.peer === key);
  return row?.state.notifyLevel ?? (kind === "channel" ? "mentions" : "dm-default");
}

/** Sets a conversation's level and updates the list at once. */
export function useSetLevel(connectionId: number | null) {
  const qc = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  return (kind: ConversationKind, key: number, notifyLevel: NotifyLevel) => {
    if (connectionId === null) return;
    api.updateConversation(connectionId, kind, key, { notifyLevel }).then(
      (state) => {
        qc.setQueryData<ConversationsDTO>(queryKeys.conversations(connectionId), (d) =>
          d ? applyStateToConversations(d, kind, key, state) : d,
        );
      },
      (err: unknown) => {
        toast(
          err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.",
          "error",
        );
      },
    );
  };
}

/** The radio items, for a menu (the thread header's bell, the row menu). */
export function LevelItems({
  kind,
  value,
  onChange,
}: {
  kind: ConversationKind;
  value: NotifyLevel;
  onChange: (level: NotifyLevel) => void;
}) {
  return (
    <Menu.RadioGroup
      value={value}
      onValueChange={(v) => {
        onChange(v as NotifyLevel);
      }}
    >
      {levelChoices(kind).map((c) => (
        <Menu.RadioItem key={c.level} value={c.level} data-mt="menu-item" data-mt-variant="radio">
          <Menu.ItemIndicator data-mt="menu-check">✓</Menu.ItemIndicator>
          {c.label}
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}

/** The thread header's bell: All / Mentions / None for this conversation (CR-003 §10). */
export function ThreadLevelMenu({
  connectionId,
  kind,
  keyNum,
}: {
  connectionId: number | null;
  kind: ConversationKind;
  keyNum: number;
}) {
  const admin = useIsAdmin();
  const level = useConversationLevel(connectionId, kind, keyNum);
  const setLevel = useSetLevel(connectionId);
  const label = levelChoices(kind).find((c) => c.level === level)?.label ?? level;
  const Icon = level === "none" ? BellOff : level === "all" ? BellRing : Bell;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          data-mt="thread-notify"
          data-mt-state={level}
          aria-label={`Notifications: ${label}`}
          title={`Notifications: ${label}`}
          disabled={!admin}
        >
          <Icon data-mt="icon" {...ICON} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-mt="conversation-menu" align="end" sideOffset={4}>
          <Menu.Label data-mt="menu-label">Notify me about</Menu.Label>
          <LevelItems
            kind={kind}
            value={level}
            onChange={(l) => {
              setLevel(kind, keyNum, l);
            }}
          />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
