import type { ConfigSchemaDTO, DeviceConfigDTO } from "@meshterm/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../data/keys.js";
import { TEST_VIEWER } from "../../test/me.js";
import { renderApp } from "../../test/render-app.js";
import { useEditsStore } from "./edits.js";

const SCHEMA: ConfigSchemaDTO = { owner: [], config: {}, moduleConfig: {}, channel: [] };
const KEY = "a2V5a2V5a2V5a2V5a2V5aw==";

const config = (): DeviceConfigDTO => ({
  connectionId: 1,
  version: "v1",
  receivedAt: 0,
  myNodeNum: 1,
  firmware: null,
  owner: { shortName: "MTB" },
  config: { lora: { region: "US" } },
  moduleConfig: {},
  channels: [
    {
      index: 0,
      role: "PRIMARY",
      settings: { name: "", psk: "AQ==", moduleSettings: { positionPrecision: 13 } },
    },
    { index: 1, role: "SECONDARY", settings: { name: "Friends", psk: KEY, uplinkEnabled: true } },
  ],
  secretsMasked: false,
});

const seed = (cfg = config()) => ({
  queries: [
    [queryKeys.configSchema, SCHEMA],
    [queryKeys.deviceConfig(1), cfg],
  ] as [readonly unknown[], unknown][],
});

beforeEach(() => {
  useEditsStore.setState({ connectionId: null, edits: {}, applyId: null });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
      if (url.startsWith("/api/config/random-psk"))
        return json({ psk: "bmV3LWtleS1uZXcta2V5IQ==" });
      if (url.includes("/channels/url/parse")) {
        return json({
          settings: [{ name: "Ops", psk: KEY.replace("a", "b") }],
          lora: null,
          add: true,
        });
      }
      if (url.includes("/channels/url")) {
        return json({
          url: "https://meshtastic.org/e/#CgMSAQE",
          qr: { size: 25, path: "M0 0h1v1h-1z" },
        });
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const slot = (i: number) => {
  const el = document.querySelectorAll<HTMLElement>("[data-mt=channel-slot]")[i];
  if (!el) throw new Error(`no slot ${i}`);
  return el;
};

describe("channels editor", () => {
  it("lists the 8 slots with role, name, encryption and precision", async () => {
    await renderApp("/settings/device?section=channels", seed());
    await screen.findByRole("list", { name: "Channel slots" });
    expect(slot(0)).toHaveAttribute("data-mt-variant", "primary");
    expect(slot(0)).toHaveTextContent("#0Primary(preset name)Default key~2.9 km");
    expect(slot(1)).toHaveTextContent("Friends");
    expect(slot(1)).toHaveTextContent("Private key");
    expect(slot(1)).toHaveTextContent("MQTT ↑");
    expect(slot(5)).toHaveAttribute("data-mt-variant", "disabled");
    expect(slot(5)).toBeDisabled();
  });

  it("edits a channel's name and key, and adds a channel with a fresh random key", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=channels", seed());
    await user.click(await screen.findByText("Friends"));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Hikers");
    await user.selectOptions(screen.getByLabelText("Key type"), "none");
    expect(screen.getByText(/the channel is unencrypted/)).toBeInTheDocument();
    expect(slot(1)).toHaveAttribute("data-mt-state", "active dirty");

    await user.click(screen.getByRole("button", { name: "Add channel" }));
    expect(await screen.findByRole("group", { name: "Channel 2" })).toBeInTheDocument();
    expect(useEditsStore.getState().edits).toMatchObject({
      "channels.1.settings.name": { value: "Hikers" },
      "channels.1.settings.psk": { value: "" },
      "channels.2.role": { value: "SECONDARY", base: undefined },
      "channels.2.settings.psk": { value: "bmV3LWtleS1uZXcta2V5IQ==" },
    });
    // The review shows keys only as changed.
    await user.click(screen.getByRole("button", { name: "Review & apply" }));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    expect(within(dialog).getByRole("row", { name: /#1 Hikers · Key/ })).toHaveTextContent(
      "(changed)",
    );
    expect(dialog).not.toHaveTextContent(KEY);
  });

  it("moves a channel and removes one added in this session", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=channels", seed());
    await user.click(await screen.findByRole("button", { name: "Add channel" }));
    await screen.findByRole("group", { name: "Channel 2" });
    await user.click(screen.getByRole("button", { name: "Move up" }));
    expect(slot(1)).toHaveTextContent("(no name)");
    expect(slot(2)).toHaveTextContent("Friends");
    await user.click(screen.getByRole("button", { name: "Move down" }));
    expect(slot(1)).toHaveTextContent("Friends");
    await user.click(slot(2));
    await user.click(screen.getByRole("button", { name: "Remove channel" }));
    expect(useEditsStore.getState().edits).toEqual({});
  });

  it("shares a link with its QR code, and stages an imported one", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=channels", seed());
    await user.click(await screen.findByRole("button", { name: "Share link / QR…" }));
    let dialog = await screen.findByRole("dialog", { name: "Share channels" });
    expect(dialog).toHaveTextContent("The link contains the channel keys");
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));
    expect(await within(dialog).findByRole("img", { name: /QR code/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Channel link")).toHaveValue(
      "https://meshtastic.org/e/#CgMSAQE",
    );
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Import link…" }));
    dialog = await screen.findByRole("dialog", { name: "Import a channel link" });
    await user.type(
      within(dialog).getByLabelText("Channel link"),
      "https://meshtastic.org/e/?add=true#x",
    );
    await user.click(within(dialog).getByRole("button", { name: "Read link" }));
    expect(await within(dialog).findByLabelText(/Add: put them in free slots/)).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Stage 3 changes" }));
    expect(useEditsStore.getState().edits).toMatchObject({
      "channels.2.role": { value: "SECONDARY" },
      "channels.2.settings.name": { value: "Ops" },
    });
  });

  it("viewers see the slots but can't add, share or import", async () => {
    await renderApp("/settings/device?section=channels", { ...seed(), me: TEST_VIEWER });
    await screen.findByRole("list", { name: "Channel slots" });
    expect(screen.queryByRole("button", { name: "Add channel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Share link/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });
});
