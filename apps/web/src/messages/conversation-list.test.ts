import { fixtures, nodeNumFromId, type MeshNode } from "@meshterm/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterChannels,
  filterDms,
  LAST_CONVERSATION_KEY,
  nodeMatches,
  pickerNodes,
  pickerWarnings,
  previewText,
  readLastConversation,
  shortAgo,
  writeLastConversation,
} from "./conversation-list.js";

const NOW = 1_800_000_000_000;
const preview = {
  id: "7d444840-9dc0-41d3-8c7b-1f2a0b3c4d5e",
  text: "hello\n  there",
  rxTime: NOW,
  direction: "in" as const,
  emoji: false,
  pkiEncrypted: false,
  status: null,
};
const node = (over: Partial<MeshNode>): MeshNode => ({ ...fixtures.node, ...over });

describe("nodeNumFromId", () => {
  it.each([
    ["!0badcafe", 0x0badcafe],
    ["0BADCAFE", 0x0badcafe],
    ["!00000000", null],
    ["!ffffffff", null],
    ["!0badcaf", null],
    ["195939070", null],
  ])("%s → %s", (id, num) => {
    expect(nodeNumFromId(id)).toBe(num);
  });
});

describe("previewText", () => {
  it("is one line, prefixed for our own messages; reactions say so", () => {
    expect(previewText(preview)).toBe("hello there");
    expect(previewText({ ...preview, direction: "out" })).toBe("You: hello there");
    expect(previewText({ ...preview, text: "👍", emoji: true })).toBe("Reacted 👍");
  });
});

describe("search", () => {
  const ridge = node({
    num: 0x0badcafe,
    id: "!0badcafe",
    longName: "Ridge Repeater",
    shortName: "RDG",
  });

  it("matches long name, short name and node id, with or without !", () => {
    for (const q of ["ridge", "rdg", "!0bad", "0badcafe", ""]) {
      expect(nodeMatches(ridge.num, ridge, q)).toBe(true);
    }
    expect(nodeMatches(ridge.num, ridge, "trail")).toBe(false);
    // An unknown node is still found by its id.
    expect(nodeMatches(0x12345678, undefined, "1234")).toBe(true);
  });

  it("filters channels by name (a leading # is ignored) and DMs by node", () => {
    const channels = [
      { index: 0, name: "LongFast", role: "PRIMARY" as const, encryption: null, lastMessage: null },
      {
        index: 1,
        name: "Friends",
        role: "SECONDARY" as const,
        encryption: null,
        lastMessage: null,
      },
    ];
    expect(filterChannels(channels, "#fri").map((c) => c.index)).toEqual([1]);
    expect(filterChannels(channels, "")).toHaveLength(2);
    const dms = [
      { peer: ridge.num, lastMessage: preview },
      { peer: 0x1a2b3c4d, lastMessage: preview },
    ];
    expect(filterDms(dms, new Map([[ridge.num, ridge]]), "rdg").map((d) => d.peer)).toEqual([
      ridge.num,
    ]);
  });
});

describe("shortAgo", () => {
  it("is compact", () => {
    expect(shortAgo(NOW - 10_000, NOW)).toBe("now");
    expect(shortAgo(NOW - 5 * 60_000, NOW)).toBe("5m");
    expect(shortAgo(NOW - 3 * 3600_000, NOW)).toBe("3h");
    expect(shortAgo(NOW - 2 * 86_400_000, NOW)).toBe("2d");
  });
});

describe("New DM picker", () => {
  it("warns about quiet nodes and nodes without a public key", () => {
    expect(pickerWarnings(node({ lastHeard: NOW - 60_000, hasPublicKey: true }), NOW)).toEqual([]);
    expect(
      pickerWarnings(node({ lastHeard: NOW - 25 * 3600_000, hasPublicKey: false }), NOW).map(
        (w) => w.kind,
      ),
    ).toEqual(["quiet", "no-key"]);
    expect(pickerWarnings(node({ lastHeard: null }), NOW).map((w) => w.kind)).toEqual(["quiet"]);
  });

  it("lists favorites first, then most recently heard, never ourselves", () => {
    const nodes = [
      node({ num: 1, lastHeard: NOW }),
      node({ num: 2, lastHeard: NOW - 1000, isFavorite: true }),
      node({ num: 3, lastHeard: null }),
      node({ num: 4, lastHeard: NOW - 10 }),
    ];
    expect(pickerNodes(nodes, 1, "").map((n) => n.num)).toEqual([2, 4, 3]);
  });
});

describe("last conversation", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips, rejects junk and survives blocked storage", () => {
    writeLastConversation({ kind: "dm", num: 0x0badcafe });
    expect(readLastConversation()).toBe("dm/!0badcafe");
    writeLastConversation({ kind: "channel", index: 2 });
    expect(readLastConversation()).toBe("channel/2");
    localStorage.setItem(LAST_CONVERSATION_KEY, "dm/../../x");
    expect(readLastConversation()).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(readLastConversation()).toBeNull();
    expect(() => {
      writeLastConversation({ kind: "channel", index: 0 });
    }).not.toThrow();
  });
});
