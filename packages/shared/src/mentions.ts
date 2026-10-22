/**
 * Mention detection (CR-003 §4.1): a message mentions us when it contains, ignoring
 * case and on word boundaries, `@` + our short name, our short name alone (unless the
 * user turned that off), our long name, or one of the user's keywords. "Word boundary"
 * is Unicode-aware: letters and digits of any script count as word characters.
 */

const WORD = String.raw`[\p{L}\p{N}_]`;
/** Before a bare term: no word character, and no `@` (that's the `@short` form, or an e-mail). */
const BEFORE_BARE = String.raw`[\p{L}\p{N}_@]`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface MentionTerms {
  longName: string;
  shortName: string;
  /** Count the short name on its own (default true); `@short` always counts. */
  matchShortName?: boolean;
  keywords?: readonly string[];
}

/** A test for the terms; never matches when there's nothing to look for. */
export function mentionMatcher(terms: MentionTerms): (text: string) => boolean {
  const alternatives: string[] = [];
  const add = (term: string) => {
    const t = term.trim();
    if (t) alternatives.push(`(?<!${BEFORE_BARE})${escape(t)}(?!${WORD})`);
  };
  const short = terms.shortName.trim();
  if (short) {
    // "@K7AB": the @ must not follow a word character (an e-mail address isn't a mention).
    alternatives.push(`(?<!${WORD})@${escape(short)}(?!${WORD})`);
    if (terms.matchShortName ?? true) add(short);
  }
  add(terms.longName);
  for (const k of terms.keywords ?? []) add(k);
  if (alternatives.length === 0) return () => false;
  const re = new RegExp(alternatives.join("|"), "iu");
  return (text) => re.test(text);
}

/** The ranges of `text` the terms match, for highlighting (`[start, end)` in UTF-16 units). */
export function mentionRanges(text: string, terms: MentionTerms): [number, number][] {
  const matcher = mentionMatcher(terms);
  if (!matcher(text)) return [];
  const parts: string[] = [];
  const short = terms.shortName.trim();
  if (short) parts.push(`@?${escape(short)}`);
  for (const t of [terms.longName, ...(terms.keywords ?? [])])
    if (t.trim()) parts.push(escape(t.trim()));
  const re = new RegExp(`(?<!${WORD})(?:${parts.join("|")})(?!${WORD})`, "giu");
  return [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
}
