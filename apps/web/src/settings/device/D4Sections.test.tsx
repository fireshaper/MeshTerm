import type { ConfigSchemaDTO, DeviceConfigDTO, FieldSchema } from "@meshterm/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../data/keys.js";
import { renderApp } from "../../test/render-app.js";
import { useEditsStore } from "./edits.js";

const f = (
  name: string,
  kind: FieldSchema["kind"],
  extra: Partial<FieldSchema> = {},
): FieldSchema => ({
  name,
  kind,
  list: false,
  ...extra,
});

const SCHEMA: ConfigSchemaDTO = {
  owner: [],
  config: {
    network: [
      f("wifiEnabled", "bool"),
      f("wifiSsid", "string"),
      f("wifiPsk", "string"),
      f("addressMode", "enum", { enumValues: ["DHCP", "STATIC"] }),
      f("ipv4Config", "message", {
        fields: [f("ip", "uint"), f("gateway", "uint"), f("subnet", "uint"), f("dns", "uint")],
      }),
    ],
    security: [
      f("publicKey", "bytes"),
      f("privateKey", "bytes"),
      f("adminKey", "bytes", { list: true }),
      f("isManaged", "bool"),
    ],
  },
  moduleConfig: {
    mqtt: [f("enabled", "bool"), f("address", "string"), f("password", "string")],
    serial: [
      f("enabled", "bool"),
      f("baud", "enum", { enumValues: ["BAUD_DEFAULT", "BAUD_9600"] }),
    ],
    paxcounter: [f("enabled", "bool")],
  },
  channel: [],
};

const config: DeviceConfigDTO = {
  connectionId: 1,
  version: "v1",
  receivedAt: 0,
  myNodeNum: 1,
  firmware: null,
  owner: { shortName: "MTB", longName: "Base" },
  config: {
    network: {
      wifiEnabled: true,
      wifiSsid: "home",
      wifiPsk: "hunter22",
      addressMode: "DHCP",
      ipv4Config: { ip: 0, gateway: 0, subnet: 0, dns: 0 },
    },
    security: { publicKey: "cHVibGlj", privateKey: "cHJpdmF0ZQ==", adminKey: [], isManaged: false },
  },
  // paxcounter isn't reported: no section for it.
  moduleConfig: {
    mqtt: { enabled: false, address: "", password: "" },
    serial: { enabled: false, baud: "BAUD_DEFAULT" },
  },
  channels: [{ index: 0, role: "PRIMARY", settings: { name: "", psk: "AQ==" } }],
  secretsMasked: false,
};

const seed = {
  queries: [
    [queryKeys.configSchema, SCHEMA],
    [queryKeys.deviceConfig(1), config],
  ] as [readonly unknown[], unknown][],
};

let calls: { url: string; body: unknown }[] = [];
beforeEach(() => {
  useEditsStore.setState({ connectionId: null, edits: {}, applyId: null });
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
      if (url === "/api/config/keypair") {
        return json({ privateKey: "bmV3LXByaXY=", publicKey: "bmV3LXB1Yg==" });
      }
      if (url.endsWith("/maintenance")) return json({ ok: true });
      if (url.endsWith("/config/snapshots")) return json([]);
      if (url.endsWith("/config/import")) {
        return json({
          owner: { longName: "Cabin" },
          config: { network: { wifiSsid: "cabin" } },
          moduleConfig: { mqtt: { enabled: true } },
          channels: null,
          fixedPosition: null,
          unknown: ["ringtone"],
        });
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("network", () => {
  it("static address: the IP fields, a lockout confirmation and the address MeshTerm will try", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=network", seed);
    expect(screen.queryByLabelText("IP address")).not.toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Address"), "STATIC");
    await user.type(screen.getByLabelText("IP address"), "192.168.1.");
    expect(screen.getByText(/Not an IPv4 address/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("IP address"), "20");
    expect(useEditsStore.getState().edits["config.network.ipv4Config.ip"]?.value).toBe(0x1401a8c0);
    await user.click(screen.getByRole("button", { name: "Review & apply" }));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "MeshTerm tries 192.0.2.1 and then the new address 192.168.1.20",
    );
    expect(within(dialog).getByRole("row", { name: /^IP address/ })).toHaveTextContent(
      "—→192.168.1.20",
    );
    const apply = within(dialog).getByRole("button", { name: "Apply 2 changes" });
    expect(apply).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "MTB");
    expect(apply).toBeEnabled();
  });
});

describe("security", () => {
  it("a new key pair is staged and only shown as changed", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=security", seed);
    await user.click(await screen.findByRole("button", { name: "New key pair…" }));
    await waitFor(() => {
      expect(useEditsStore.getState().edits).toMatchObject({
        "config.security.privateKey": { value: "bmV3LXByaXY=" },
        "config.security.publicKey": { value: "bmV3LXB1Yg==" },
      });
    });
    await user.click(screen.getByRole("button", { name: "Review & apply" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("row", { name: /Private key/ })).toHaveTextContent("(changed)");
    expect(dialog).not.toHaveTextContent("bmV3LXByaXY=");
    expect(within(dialog).getByText(/Type the node's short name/)).toBeInTheDocument();
  });
});

describe("modules", () => {
  it("one section per module the node reports, with generic fields", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=module-serial", seed);
    expect(await screen.findByText("Modules")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Device settings sections" });
    expect(within(nav).getByRole("link", { name: /^MQTT/ })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Paxcounter/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Baud")).toHaveValue("BAUD_DEFAULT");
    await user.click(within(nav).getByRole("link", { name: /^MQTT/ }));
    expect(await screen.findByLabelText("Password")).toHaveAttribute("type", "password");
  });
});

describe("maintenance", () => {
  it("reboot needs a simple confirm; factory resets the short name", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=maintenance", seed);
    await user.click(await screen.findByRole("button", { name: "Reboot…" }));
    let dialog = await screen.findByRole("dialog", { name: "Reboot" });
    await user.click(within(dialog).getByRole("button", { name: "Reboot" }));
    await waitFor(() => {
      expect(calls.find((c) => c.url.endsWith("/maintenance"))?.body).toEqual({ action: "reboot" });
    });

    await user.click(screen.getByRole("button", { name: "Factory reset (config)…" }));
    dialog = await screen.findByRole("dialog", { name: "Factory reset (config)" });
    const go = within(dialog).getByRole("button", { name: "Factory reset (config)" });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "MTB");
    await user.click(go);
    await waitFor(() => {
      expect(calls.filter((c) => c.url.endsWith("/maintenance")).at(-1)?.body).toEqual({
        action: "factory_reset_config",
        confirm: "MTB",
      });
    });

    await user.click(screen.getByRole("button", { name: "Factory reset (device)…" }));
    dialog = await screen.findByRole("dialog", { name: "Factory reset (device)" });
    await user.type(within(dialog).getByRole("textbox"), "MTB");
    // Still counting down.
    expect(
      within(dialog).getByRole("button", { name: /Factory reset \(device\) \(\d\)/ }),
    ).toBeDisabled();
  });
});

describe("backup & restore", () => {
  it("an imported file shows its changes; network is left out unless ticked", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=backup", seed);
    expect(await screen.findByRole("link", { name: "Download backup" })).toHaveAttribute(
      "href",
      "/api/connections/1/config/export?secrets=false",
    );
    const file = new File(["owner: Cabin\n"], "cabin.yaml", { type: "application/yaml" });
    await user.upload(screen.getByLabelText(/Choose a YAML file/), file);
    const dialog = await screen.findByRole("dialog", { name: "Import cabin.yaml" });
    expect(within(dialog).getByRole("checkbox", { name: /Network/ })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /User/ })).toBeChecked();
    expect(dialog).toHaveTextContent("Skipped (MeshTerm doesn't know them): ringtone.");
    await user.click(within(dialog).getByRole("button", { name: "Stage 2 changes" }));
    expect(Object.keys(useEditsStore.getState().edits).sort()).toEqual([
      "moduleConfig.mqtt.enabled",
      "owner.longName",
    ]);
  });
});
