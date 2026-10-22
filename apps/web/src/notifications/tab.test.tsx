import { fixtures, type Message, type NotifyHint } from "@meshterm/shared";
import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { resetLiveStore, useLiveStore } from "../data/store.js";
import { flashText, handleMessageNew, resetNotifyCenter, useNotifyCenter } from "./center.js";
import { DEFAULT_BROWSER_SETTINGS, useBrowserNotifySettings } from "./settings.js";
import { faviconLabel, FLASH_MS, tabTitle, useTabTitle } from "./tab.js";

const dm: Message = { ...fixtures.inboundMessage, text: "Heading out now, see you at the shop" };
const hint: NotifyHint = { level: "notify", reason: "dm", backlog: false };

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  resetNotifyCenter();
  resetLiveStore();
  useBrowserNotifySettings.setState({ settings: DEFAULT_BROWSER_SETTINGS });
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.spyOn(document, "hasFocus").mockImplementation(() => visibility === "visible");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("title and favicon text", () => {
  it("counts, warns while disconnected, and caps at 99+", () => {
    expect(tabTitle(0, false)).toBe("MeshTerm");
    expect(tabTitle(3, false)).toBe("(3) MeshTerm");
    expect(tabTitle(3, true)).toBe("⚠ (3) MeshTerm");
    expect(tabTitle(250, false)).toBe("(99+) MeshTerm");
    expect(faviconLabel(0)).toBeNull();
    expect(faviconLabel(7)).toBe("7");
    expect(faviconLabel(10)).toBe("");
    expect(flashText("K7AB", dm.text)).toBe("💬 K7AB: Heading out now, see you at th…");
    expect(flashText("K7AB", dm.text)).toHaveLength(40);
  });

  it("a disconnected node shows in the title", () => {
    useLiveStore.getState().setNodeState("reconnecting");
    renderHook(() => {
      useTabTitle(2);
    });
    expect(document.title).toBe("⚠ (2) MeshTerm");
  });
});

describe("message.new in the center", () => {
  const qc = () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.nodes(1), [
      { ...fixtures.node, num: dm.fromNum, shortName: "RDG" },
    ]);
    return client;
  };

  it("while hidden: an event is kept and the title flashes until the tab is back", () => {
    vi.useFakeTimers();
    visibility = "hidden";
    renderHook(() => {
      useTabTitle(1);
    });
    act(() => {
      handleMessageNew(qc(), dm, hint);
    });
    expect(useNotifyCenter.getState().events).toHaveLength(1);
    expect(useNotifyCenter.getState().events[0]?.title).toBe("RDG");
    expect(document.title).toBe("(1) MeshTerm");
    act(() => {
      vi.advanceTimersByTime(FLASH_MS);
    });
    expect(document.title).toBe("💬 RDG: Heading out now, see you at the…");
    act(() => {
      vi.advanceTimersByTime(FLASH_MS);
    });
    expect(document.title).toBe("(1) MeshTerm");

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(useNotifyCenter.getState().flash).toBeNull();
    act(() => {
      vi.advanceTimersByTime(FLASH_MS * 3);
    });
    expect(document.title).toBe("(1) MeshTerm");
  });

  it("nothing for the conversation being read, during DND, or for badge-only hints", () => {
    const client = qc();
    useNotifyCenter.getState().setViewing({ connectionId: 1, kind: "dm", key: dm.peer ?? 0 });
    handleMessageNew(client, dm, hint);
    useNotifyCenter.getState().setViewing(null);
    handleMessageNew(client, dm, { level: "badge", reason: null, backlog: false });
    client.setQueryData(queryKeys.notificationPrefs, {
      dndUntil: Date.now() + 60_000,
      quietHours: null,
      quietAllowDms: false,
      mentionKeywords: [],
      reactionsMode: "in-app",
      matchShortName: true,
      serverUtcOffsetMinutes: 0,
    });
    handleMessageNew(client, dm, hint);
    expect(useNotifyCenter.getState().events).toEqual([]);
    expect(useNotifyCenter.getState().flash).toBeNull();
  });
});
