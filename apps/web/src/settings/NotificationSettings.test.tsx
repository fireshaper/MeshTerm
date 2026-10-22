import { DND_FOREVER } from "@meshterm/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_SETTINGS_KEY,
  DEFAULT_BROWSER_SETTINGS,
  useBrowserNotifySettings,
} from "../notifications/settings.js";
import { renderApp } from "../test/render-app.js";
import { scenarioChannels, scenarioNodes, SCENARIO_MY_NODE } from "../test/scenario.js";

const NOW = Date.now();
let calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  calls = [];
  useBrowserNotifySettings.setState({ settings: DEFAULT_BROWSER_SETTINGS });
  try {
    localStorage.removeItem(BROWSER_SETTINGS_KEY);
  } catch {
    // ignore
  }
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b)));
      if (url === "/api/me/notification-prefs" && method === "PATCH") {
        return json({
          dndUntil: null,
          quietHours: null,
          quietAllowDms: false,
          mentionKeywords: [],
          reactionsMode: "in-app",
          matchShortName: true,
          serverUtcOffsetMinutes: 0,
          ...body,
        });
      }
      if (method === "PATCH") {
        return json({ lastReadRxTime: 0, muted: false, favorite: false, ...body });
      }
      return json([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const seed = () => ({
  channels: scenarioChannels(),
  nodes: scenarioNodes("default", NOW),
  myNodeNum: SCENARIO_MY_NODE,
});
const patches = () => calls.filter((c) => c.method === "PATCH").map((c) => c.body);

describe("Settings → Notifications", () => {
  it("browser settings apply at once and are remembered in this browser", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/notifications", seed());
    await user.click(screen.getByLabelText("Sounds"));
    await user.click(screen.getByLabelText(/Flash the tab title/));
    await user.selectOptions(screen.getByLabelText("Where they appear (desktop)"), "bottom-left");
    expect(useBrowserNotifySettings.getState().settings).toMatchObject({
      sounds: false,
      titleFlash: false,
      toastPosition: "bottom-left",
    });
    expect(JSON.parse(localStorage.getItem(BROWSER_SETTINGS_KEY) ?? "{}")).toMatchObject({
      sounds: false,
    });
    expect(screen.getByLabelText("Mentions and replies")).toBeDisabled();
  });

  it("explains why desktop notifications are off on plain HTTP", async () => {
    vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn() });
    vi.stubGlobal("isSecureContext", false);
    await renderApp("/settings/notifications", seed());
    expect(screen.getByLabelText(/Desktop notifications/)).toBeDisabled();
    expect(screen.getByText(/only allow desktop notifications on HTTPS/)).toBeInTheDocument();
  });

  it("account settings are saved to the server", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/notifications", seed());
    await user.type(screen.getByLabelText("Mention keywords"), "base camp, k7ab ,");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByLabelText(/Quiet hours every day/));
    await user.selectOptions(screen.getByLabelText("Reactions to my messages"), "off");
    await user.click(screen.getByRole("button", { name: "Until I turn it off" }));
    await waitFor(() => {
      expect(patches()).toEqual([
        { mentionKeywords: ["base camp", "k7ab"] },
        { quietHours: { start: "22:00", end: "07:00" } },
        { reactionsMode: "off" },
        { dndUntil: DND_FOREVER },
      ]);
    });
    expect(await screen.findByText("On until you turn it off.")).toBeInTheDocument();
  });
});

describe("per-conversation levels", () => {
  it("the thread header's bell sets All / Mentions / Nothing", async () => {
    const user = userEvent.setup();
    await renderApp("/messages/channel/0", seed());
    await user.click(
      screen.getByRole("button", { name: "Notifications: Mentions only (default)" }),
    );
    await user.click(await screen.findByRole("menuitemradio", { name: /All messages/ }));
    await waitFor(() => {
      expect(patches()).toEqual([{ notifyLevel: "all" }]);
    });
    expect(
      await screen.findByRole("button", { name: "Notifications: All messages" }),
    ).toBeInTheDocument();
  });
});
