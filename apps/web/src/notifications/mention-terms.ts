import { mentionRanges, type MentionTerms } from "@meshterm/shared";
import { useMemo } from "react";
import { useNodes } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { useNotificationPrefs } from "./runtime.js";

/** What counts as a mention of this user: the node's names and their keywords (CR-003 §4.1). */
export function useMentionTerms(connectionId: number | null): MentionTerms | null {
  const myNodeNum = useLiveStore((s) => s.myNodeNum);
  const { data: nodes } = useNodes(connectionId);
  const { data: prefs } = useNotificationPrefs();
  const own = nodes?.find((n) => n.num === myNodeNum);
  const longName = own?.longName ?? "";
  const shortName = own?.shortName ?? "";
  const matchShortName = prefs?.matchShortName ?? true;
  const keywords = prefs?.mentionKeywords;
  return useMemo(
    () =>
      longName || shortName
        ? { longName, shortName, matchShortName, keywords: keywords ?? [] }
        : null,
    [longName, shortName, matchShortName, keywords],
  );
}

/** The text in pieces, mentions marked, for the bubble. */
export function splitMentions(
  text: string,
  terms: MentionTerms | null,
): { text: string; mention: boolean }[] {
  if (!terms) return [{ text, mention: false }];
  const parts: { text: string; mention: boolean }[] = [];
  let at = 0;
  for (const [start, end] of mentionRanges(text, terms)) {
    if (start > at) parts.push({ text: text.slice(at, start), mention: false });
    parts.push({ text: text.slice(start, end), mention: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), mention: false });
  return parts.length > 0 ? parts : [{ text, mention: false }];
}
