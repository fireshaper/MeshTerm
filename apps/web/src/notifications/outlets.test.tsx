import { fixtures } from "@meshterm/shared";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerOpener,
  resetNotifyCenter,
  useNotifyCenter,
  type NotificationEvent,
} from "./center.js";
import {
  closeDesktopNotification,
  desktopContent,
  desktopSupport,
  showDesktopNotification,
} from "./desktop.js";
import { BANNER_DISMISSED_KEY, PermissionBanner } from "./PermissionBanner.js";
import { SILENT } from "./rules.js";
import { DEFAULT_BROWSER_SETTINGS, useBrowserNotifySettings } from "./settings.js";
import { SOUND_THROTTLE_MS, SoundPlayer, themeSoundUrls } from "./sounds.js";

const event = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
  id: "e1",
  at: 0,
  kind: "message",
  variant: "dm",
  message: {
    ...fixtures.inboundMessage,
    text: "Heading out now, see you at the shop in about twenty minutes, ok?",
  },
  alert: { ...SILENT, os: true },
  title: "RDG",
  target: { connectionId: 1, kind: "dm", key: 0x0badcafe },
  unread: true,
  ...over,
});

describe("SoundPlayer", () => {
  const fakeAudio = () => {
    const played: string[] = [];
    const make = (url: string) =>
      ({
        src: url,
        volume: 1,
        currentTime: 0,
        muted: false,
        preload: "",
        play: () => {
          played.push(url);
          return Promise.resolve();
        },
        pause: () => undefined,
      }) as unknown as HTMLAudioElement;
    return { played, make };
  };

  it("plays at the set volume, at most once every 2 s, and fails silently", () => {
    let now = 10_000;
    const { played, make } = fakeAudio();
    const player = new SoundPlayer(() => now, make);
    expect(player.play("message", 0.6)).toBe(true);
    expect(player.play("mention", 0.6)).toBe(false);
    now += SOUND_THROTTLE_MS;
    expect(player.play("mention", 0.6)).toBe(true);
    expect(played).toEqual(["/sounds/message.wav", "/sounds/mention.wav"]);
    const blocked = new SoundPlayer(
      () => (now += 5_000),
      (url) =>
        ({
          src: url,
          play: () => {
            throw new Error("NotAllowedError");
          },
        }) as unknown as HTMLAudioElement,
    );
    expect(() => blocked.play("channel", 1)).not.toThrow();
  });

  it("takes a theme's sounds, only from inside the theme", async () => {
    expect(
      themeSoundUrls("/themes/retro/", {
        sounds: { message: "sounds/beep.wav", mention: "../../secret", other: "x.wav" },
      }),
    ).toEqual({ message: "/themes/retro/sounds/beep.wav" });
    expect(themeSoundUrls("/themes/retro/", {})).toEqual({});

    const link = document.createElement("link");
    link.dataset.mt = "theme-link";
    link.setAttribute("href", "/themes/retro/theme.css");
    document.head.appendChild(link);
    const player = new SoundPlayer(Date.now, fakeAudio().make);
    await player.load(() => Promise.resolve({ sounds: { channel: "./blip.wav" } }));
    expect(player.urlOf("channel")).toBe("/themes/retro/blip.wav");
    expect(player.urlOf("message")).toBe("/sounds/message.wav");
    link.remove();
  });
});

describe("desktop notifications", () => {
  const shown: { title: string; options: NotificationOptions; closed: boolean; n: unknown }[] = [];
  class FakeNotification {
    static permission: NotificationPermission = "granted";
    static requestPermission = vi.fn(() => Promise.resolve("granted" as NotificationPermission));
    onclick: (() => void) | null = null;
    onclose: (() => void) | null = null;
    private readonly entry;
    constructor(title: string, options: NotificationOptions) {
      this.entry = { title, options, closed: false, n: this };
      shown.push(this.entry);
    }
    close() {
      this.entry.closed = true;
    }
  }

  beforeEach(() => {
    shown.length = 0;
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("isSecureContext", true);
    resetNotifyCenter();
    useBrowserNotifySettings.setState({ settings: DEFAULT_BROWSER_SETTINGS });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    registerOpener(null);
    try {
      localStorage.removeItem(BANNER_DISMISSED_KEY);
    } catch {
      // ignore
    }
  });

  it("knows when it can't work: no API, or plain http on a LAN address", () => {
    expect(desktopSupport()).toEqual({ state: "ready", permission: "granted" });
    vi.stubGlobal("isSecureContext", false);
    expect(desktopSupport()).toEqual({ state: "insecure" });
  });

  it("one per conversation (tag, renotify); click opens it; reading closes it", () => {
    const opened: unknown[] = [];
    registerOpener((t) => opened.push(t));
    showDesktopNotification(event(), "Ridge Repeater", false);
    expect(shown[0]?.title).toBe("RDG (Ridge Repeater)");
    expect(shown[0]?.options).toMatchObject({
      body: "Heading out now, see you at the shop in about twenty minute…",
      tag: "1:dm:195939070",
      renotify: true,
      icon: "/favicon.svg",
    });
    showDesktopNotification(event({ id: "e2" }), "Ridge Repeater", false);
    expect(shown[0]?.closed).toBe(true);
    (shown[1]?.n as FakeNotification).onclick?.();
    expect(opened).toEqual([{ connectionId: 1, kind: "dm", key: 0x0badcafe }]);
    expect(shown[1]?.closed).toBe(true);

    showDesktopNotification(event({ id: "e3" }), null, false);
    closeDesktopNotification("1:dm:195939070");
    expect(shown[2]?.closed).toBe(true);
  });

  it("hides the text when asked; nothing without permission", () => {
    expect(desktopContent(event(), "Ridge Repeater", true)).toEqual({
      title: "MeshTerm",
      body: "New direct message",
    });
    expect(
      desktopContent(
        event({
          variant: "mention",
          title: "#LongFast · RDG",
          target: { connectionId: 1, kind: "channel", key: 0 },
        }),
        null,
        true,
      ),
    ).toEqual({ title: "#LongFast", body: "New mention" });
    FakeNotification.permission = "denied";
    expect(showDesktopNotification(event(), null, false)).toBeNull();
    FakeNotification.permission = "granted";
  });

  it("the banner appears after a DM, asks only on Enable, and remembers Not now", async () => {
    FakeNotification.permission = "default";
    const user = userEvent.setup();
    const { unmount } = render(<PermissionBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    act(() => {
      useNotifyCenter.setState({ events: [event()] });
    });
    expect(screen.getByRole("region", { name: "Desktop notifications" })).toBeInTheDocument();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enable" }));
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    expect(useBrowserNotifySettings.getState().settings.desktop).toBe(true);
    unmount();

    useBrowserNotifySettings.setState({ settings: DEFAULT_BROWSER_SETTINGS });
    const again = render(<PermissionBanner />);
    await user.click(screen.getByRole("button", { name: "Not now" }));
    again.unmount();
    render(<PermissionBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    FakeNotification.permission = "granted";
  });
});
