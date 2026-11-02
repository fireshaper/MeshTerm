import type { ApplyStatusDTO, ConfigSchemaDTO, DeviceConfigDTO } from "@meshterm/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../data/keys.js";
import { byDataMt } from "../../test/data-mt.js";
import { TEST_VIEWER } from "../../test/me.js";
import { renderApp } from "../../test/render-app.js";
import { useEditsStore } from "./edits.js";

const f = (
  name: string,
  kind: ConfigSchemaDTO["owner"][number]["kind"],
  enumValues?: string[],
) => ({
  name,
  kind,
  list: false,
  ...(enumValues ? { enumValues } : {}),
});

const SCHEMA: ConfigSchemaDTO = {
  owner: [
    f("id", "string"),
    f("longName", "string"),
    f("shortName", "string"),
    f("isLicensed", "bool"),
  ],
  config: {
    device: [f("role", "enum", ["CLIENT", "CLIENT_MUTE", "ROUTER"]), f("isManaged", "bool")],
    lora: [
      f("usePreset", "bool"),
      f("modemPreset", "enum", ["LONG_FAST", "MEDIUM_FAST"]),
      f("bandwidth", "uint"),
      f("region", "enum", ["UNSET", "US", "EU_868"]),
      f("hopLimit", "uint"),
      f("txPower", "int"),
      f("someNewField", "uint"),
    ],
    display: [f("screenOnSecs", "uint")],
  },
  moduleConfig: {},
  channel: [],
};

const config = (patch: { hopLimit?: number; version?: string } = {}): DeviceConfigDTO => ({
  connectionId: 1,
  version: patch.version ?? "v1",
  receivedAt: 0,
  myNodeNum: 1,
  firmware: "2.6.11",
  owner: { id: "!00000001", longName: "Base station", shortName: "BASE", isLicensed: false },
  config: {
    device: { role: "CLIENT", isManaged: false },
    lora: {
      usePreset: true,
      modemPreset: "LONG_FAST",
      bandwidth: 0,
      region: "US",
      hopLimit: patch.hopLimit ?? 3,
      txPower: 0,
      someNewField: 0,
    },
    display: { screenOnSecs: 60 },
  },
  moduleConfig: {},
  channels: [],
  secretsMasked: false,
});

const status = (
  phase: ApplyStatusDTO["phase"],
  over: Partial<ApplyStatusDTO> = {},
): ApplyStatusDTO => ({
  applyId: "a1",
  connectionId: 1,
  phase,
  by: null,
  startedAt: 0,
  finishedAt: null,
  paths: ["config.lora.hopLimit"],
  mismatches: [],
  error: null,
  newHost: null,
  ...over,
});

const seed = (cfg = config()) => ({
  queries: [
    [queryKeys.configSchema, SCHEMA],
    [queryKeys.deviceConfig(1), cfg],
  ] as [readonly unknown[], unknown][],
});

let posted: unknown[] = [];

beforeEach(() => {
  useEditsStore.setState({ connectionId: null, edits: {}, applyId: null });
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/config/apply") && init?.method === "POST") {
        posted.push(JSON.parse(init.body as string));
        return Promise.resolve(new Response(JSON.stringify(status("applying")), { status: 202 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const field = (path: string) => {
  const el = document.querySelector(`[data-mt="config-field"][data-path="${path}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no field ${path}`);
  return el;
};

describe("device settings", () => {
  it("/settings leads to the device settings, one section at a time", async () => {
    await renderApp("/settings", seed());
    expect(await screen.findByRole("heading", { name: "Device" })).toBeInTheDocument();
    expect(screen.getByLabelText("Long name")).toHaveValue("Base station");
    // Identity fields are shown, never editable.
    expect(screen.getByLabelText("Node ID")).toBeDisabled();
    const header = byDataMt("device-header");
    expect(header).toHaveTextContent("BASE");
    expect(header).toHaveTextContent("Base station");
    expect(header).toHaveTextContent("Firmware2.6.11");
    // Each section tile says what is set.
    const lora = screen.getByRole("link", { name: /^LoRa/ });
    expect(lora).toHaveTextContent("US · Long Fast · 3 hops");
  });

  it("stages an edit, reviews it and applies it; the result clears the edits", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderApp("/settings/device?section=lora", seed());
    const hops = await screen.findByLabelText("Hop limit");
    await user.clear(hops);
    await user.type(hops, "5");

    const el = field("config.lora.hopLimit");
    expect(el).toHaveAttribute("data-mt-state", "changed");
    expect(within(el).getByText("was: 3")).toBeInTheDocument();
    expect(within(el).getByText("More than 3 hops costs everyone airtime.")).toBeInTheDocument();
    expect(within(el).getByText("changed")).toBeInTheDocument();
    const tray = screen.getByRole("region", { name: "Unsaved changes" });
    expect(tray).toHaveTextContent("1 unsaved change");
    expect(tray).toHaveTextContent("Saving LoRa settings reboots the node");
    expect(screen.getByLabelText("1 unsaved")).toBeInTheDocument();

    await user.click(within(tray).getByRole("button", { name: "Review and apply" }));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    const row = within(dialog).getByRole("row", { name: /Hop limit/ });
    expect(row).toHaveTextContent("3→5");
    expect(dialog).toHaveTextContent("The node will save the settings and reboot.");
    await user.click(within(dialog).getByRole("button", { name: "Apply 1 change" }));

    expect(posted).toEqual([{ baseVersion: "v1", changes: { config: { lora: { hopLimit: 5 } } } }]);
    expect(await screen.findByRole("heading", { name: "Applying changes…" })).toBeInTheDocument();
    // Locked while it runs.
    expect(screen.getByLabelText("Hop limit")).toBeDisabled();

    act(() => {
      queryClient.setQueryData(queryKeys.configApply(1), status("verified"));
      queryClient.setQueryData(queryKeys.deviceConfig(1), config({ hopLimit: 5, version: "v2" }));
    });
    expect(
      await screen.findByRole("heading", { name: "Applied and verified" }),
    ).toBeInTheDocument();
    expect(useEditsStore.getState().edits).toEqual({});
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Hop limit")).toHaveValue(5);
  });

  it("hides custom modem fields while a preset is used, and unknown fields under advanced", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=lora", seed());
    await screen.findByLabelText("Hop limit");
    expect(screen.queryByLabelText(/Bandwidth/)).not.toBeInTheDocument();
    // Unknown fields sit in the folded Advanced part.
    expect(screen.getByLabelText("Some new field")).not.toBeVisible();
    await user.click(screen.getByLabelText("Use a modem preset"));
    expect(screen.getByLabelText(/Bandwidth/)).toBeInTheDocument();
    await user.click(screen.getByText(/^Advanced \(\d+\)$/));
    expect(screen.getByLabelText("Some new field")).toBeVisible();
    expect(screen.getByRole("group", { name: "Other" })).toBeInTheDocument();
  });

  it("marks a field changed on the device and blocks apply until resolved", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderApp("/settings/device?section=lora", seed());
    const hops = await screen.findByLabelText("Hop limit");
    await user.clear(hops);
    await user.type(hops, "4");
    act(() => {
      queryClient.setQueryData(queryKeys.deviceConfig(1), config({ hopLimit: 2, version: "v2" }));
    });
    const el = field("config.lora.hopLimit");
    expect(await within(el).findByText("Changed on device: now 2.")).toBeInTheDocument();
    expect(el).toHaveAttribute("data-mt-state", "changed conflict");
    await user.click(screen.getByRole("button", { name: "Review and apply" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Apply 1 change" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(el).getByRole("button", { name: "Keep mine" }));
    expect(el).toHaveAttribute("data-mt-state", "changed");
    expect(within(el).getByText("was: 2")).toBeInTheDocument();
  });

  it("asks for the short name before a lockout-class change", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=device", seed());
    await user.click(await screen.findByLabelText("Managed mode"));
    await user.click(screen.getByRole("button", { name: "Review and apply" }));
    const dialog = await screen.findByRole("dialog");
    const apply = within(dialog).getByRole("button", { name: "Apply 1 change" });
    expect(apply).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "BASE");
    expect(apply).toBeEnabled();
  });

  it("locks the editor while someone else's apply runs", async () => {
    const s = seed();
    s.queries.push([queryKeys.configApply(1), status("rebooting", { by: "bob" })]);
    await renderApp("/settings/device?section=lora", s);
    expect(await screen.findByText(/Apply in progress by bob/)).toBeInTheDocument();
    expect(screen.getByLabelText("Hop limit")).toBeDisabled();
  });

  it("shows the recovery panel when the node doesn't come back", async () => {
    const s = seed();
    s.queries.push([queryKeys.configApply(1), status("recovery")]);
    await renderApp("/settings/device", s);
    const panel = byDataMt("recovery-panel");
    expect(panel).toHaveTextContent("192.0.2.1:4403");
    expect(panel).toHaveTextContent("Changed: Hop limit.");
  });

  it("viewers see everything read-only, without the tray", async () => {
    await renderApp("/settings/device?section=lora", { ...seed(), me: TEST_VIEWER });
    expect(await screen.findByLabelText("Hop limit")).toBeDisabled();
    expect(screen.getByText(/You're a viewer/)).toBeInTheDocument();
  });
});

describe("LoRa controls (CR-005 K6)", () => {
  it("preset cards stage the preset; the frequency follows region and preset", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=lora", seed());
    const longFast = await screen.findByRole("radio", { name: /Long Fast/ });
    expect(longFast).toBeChecked();
    expect(screen.getByRole("radio", { name: /Medium Fast/ })).toHaveAccessibleName(
      "Medium Fast SF9 · 250 kHz 3.5 kbps",
    );
    const frequency = byDataMt("lora-frequency");
    expect(frequency).toHaveTextContent("906.875 MHz");
    expect(frequency).toHaveTextContent("slot 20 · picked from the preset name “LongFast”");

    await user.click(screen.getByRole("radio", { name: /Medium Fast/ }));
    expect(field("config.lora.modemPreset")).toHaveAttribute("data-mt-state", "changed");
    expect(frequency).toHaveTextContent("“MediumFast”");

    await user.selectOptions(screen.getByLabelText("Region"), "EU_868");
    await user.click(screen.getByRole("radio", { name: /Long Fast/ }));
    expect(frequency).toHaveTextContent("869.525 MHz");
    expect(byDataMt("tx-power-limit")).toHaveTextContent("limit 27 dBm");
  });

  it("TX power is bounded by the region; the hop stepper counts", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=lora", seed());
    await user.selectOptions(await screen.findByLabelText("Region"), "EU_868");
    const power = screen.getByLabelText("TX power (dBm)");
    await user.clear(power);
    await user.type(power, "30");
    expect(
      within(field("config.lora.txPower")).getByText("The EU_868 limit is 27 dBm."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "More hops" }));
    expect(screen.getByLabelText("Hop limit")).toHaveValue(4);
    await user.click(screen.getByRole("button", { name: "Fewer hops" }));
    await user.click(screen.getByRole("button", { name: "Fewer hops" }));
    expect(screen.getByLabelText("Hop limit")).toHaveValue(2);
  });

  it("the apply bar counts changes, Discard drops them, and the review warns about the mesh", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=lora", seed());
    await user.click(await screen.findByRole("button", { name: "More hops" }));
    await user.click(screen.getByRole("radio", { name: /Medium Fast/ }));
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    expect(bar).toHaveTextContent("2 unsaved changes");

    await user.click(within(bar).getByRole("button", { name: "Review and apply" }));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    expect(dialog).toHaveTextContent(
      "Nodes on a different preset can't hear each other. Change every node on your mesh, or this one goes quiet.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.click(within(bar).getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Long Fast/ })).toBeChecked();
  });
});
