import { describe, expect, it } from "vitest";
import { electLeader, STALE_MS, TabLeader, type TabInfo } from "./leader.js";

const tab = (id: string, focused: boolean, lastFocusedAt: number, seenAt = 1_000): TabInfo => ({
  id,
  focused,
  lastFocusedAt,
  seenAt,
});

describe("electLeader", () => {
  it("the focused tab leads; else the most recently focused; ties by id", () => {
    expect(electLeader([tab("a", false, 900), tab("b", true, 100)], 1_000)).toBe("b");
    expect(electLeader([tab("a", false, 900), tab("b", false, 100)], 1_000)).toBe("a");
    expect(electLeader([tab("b", false, 0), tab("a", false, 0)], 1_000)).toBe("a");
    expect(electLeader([], 1_000)).toBeNull();
  });

  it("tabs that stopped announcing themselves don't count", () => {
    const old = tab("a", true, 900, 0);
    expect(electLeader([old, tab("b", false, 100, STALE_MS)], STALE_MS + 1)).toBe("b");
  });
});

/** An in-memory BroadcastChannel shared by tabs in a test. */
function fakeBus() {
  const members = new Set<{ onmessage: ((e: MessageEvent) => void) | null }>();
  return () => {
    const channel = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage(data: unknown) {
        for (const m of members) if (m !== channel) m.onmessage?.({ data } as MessageEvent);
      },
      close() {
        members.delete(channel);
      },
    };
    members.add(channel);
    return channel as unknown as BroadcastChannel;
  };
}

describe("TabLeader", () => {
  it("with three tabs, exactly one leads: the focused one, else the last focused", () => {
    const bus = fakeBus();
    let now = 10_000;
    let focusedTab = "";
    const make = () => {
      const t: TabLeader = new TabLeader({
        now: () => now,
        focused: () => focusedTab === t.id,
        channel: bus(),
      });
      return t;
    };
    const tabs = [make(), make(), make()];
    const [a, b, c] = tabs as [TabLeader, TabLeader, TabLeader];
    focusedTab = b.id;
    for (const t of tabs) t.announce();
    expect(tabs.filter((t) => t.isLeader).map((t) => t.id)).toEqual([b.id]);

    // b loses focus to another app: still the most recently focused, still leads.
    now += 500;
    focusedTab = "";
    for (const t of tabs) t.announce();
    expect(tabs.filter((t) => t.isLeader).map((t) => t.id)).toEqual([b.id]);

    // c is focused; then b closes.
    now += 500;
    focusedTab = c.id;
    for (const t of tabs) t.announce();
    expect(tabs.filter((t) => t.isLeader).map((t) => t.id)).toEqual([c.id]);
    expect(a.isLeader).toBe(false);
  });

  it("leads alone without BroadcastChannel", () => {
    expect(new TabLeader({ channel: null, focused: () => false }).isLeader).toBe(true);
  });
});
