import { describe, expect, it } from "vitest";
import { mentionMatcher, mentionRanges } from "./mentions.js";

const me = { longName: "Kevin's Base", shortName: "K7AB" };

describe("mentionMatcher", () => {
  it("matches the short name, @short and the long name, ignoring case", () => {
    const m = mentionMatcher(me);
    expect(m("@K7AB you there?")).toBe(true);
    expect(m("k7ab: heading out")).toBe(true);
    expect(m("ask kevin's base about it")).toBe(true);
    expect(m("nothing for us")).toBe(false);
  });

  it("only on word boundaries", () => {
    const m = mentionMatcher({ longName: "Base", shortName: "BAS" });
    expect(m("baseline readings")).toBe(false);
    expect(m("basement")).toBe(false);
    expect(m("at the base.")).toBe(true);
    expect(m("BAS_2 is offline")).toBe(false);
    // An e-mail address isn't an @mention.
    expect(m("mail me@BAS")).toBe(false);
  });

  it("is Unicode-aware", () => {
    const m = mentionMatcher({ longName: "Ödön", shortName: "ÖD" });
    expect(m("szia ödön!")).toBe(true);
    expect(m("Ödönke")).toBe(false);
    expect(m("@öd hello")).toBe(true);
    expect(mentionMatcher({ longName: "Звезда", shortName: "ЗВ" })("привет, звезда")).toBe(true);
    expect(mentionMatcher({ longName: "🚀 Rocket", shortName: "🚀" })("go 🚀 go")).toBe(true);
  });

  it("can leave the short name alone out, and adds keywords", () => {
    const m = mentionMatcher({ ...me, matchShortName: false, keywords: ["callsign", "  "] });
    expect(m("k7ab: heading out")).toBe(false);
    expect(m("@k7ab heading out")).toBe(true);
    expect(m("what's your CALLSIGN")).toBe(true);
    expect(mentionMatcher({ longName: "", shortName: "" })("anything")).toBe(false);
  });

  it("finds the ranges to highlight", () => {
    const text = "@K7AB meet at Kevin's Base";
    expect(mentionRanges(text, me).map(([a, b]) => text.slice(a, b))).toEqual([
      "@K7AB",
      "Kevin's Base",
    ]);
    expect(mentionRanges("nothing", me)).toEqual([]);
  });
});
