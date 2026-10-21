import { describe, expect, it } from "vitest";
import { restoreEdits, type RestoreSource } from "./BackupRestore.js";
import { buildChanges, getterFor, summarize, type ConfigView } from "./edits.js";
import { allSections, isSectionId, metaFor, sectionOf, validateField } from "./registry.js";

const cfg = (): ConfigView => ({
  connectionId: 1,
  version: "v1",
  receivedAt: 0,
  myNodeNum: 1,
  firmware: null,
  owner: { id: "!00000001", longName: "Base", shortName: "MTB", hwModel: "HELTEC_V3" },
  config: {
    network: {
      wifiEnabled: true,
      wifiSsid: "home",
      addressMode: "DHCP",
      ipv4Config: { ip: 0, gateway: 0, subnet: 0, dns: 0 },
    },
    security: { isManaged: false, publicKey: "cHVi", privateKey: "cHJpdg==" },
    lora: { hopLimit: 3 },
  },
  moduleConfig: { mqtt: { enabled: false, address: "" } },
  channels: [{ index: 0, role: "PRIMARY", settings: { name: "", psk: "AQ==" } }],
  secretsMasked: false,
});

describe("network and security", () => {
  it("nests static address edits into a partial network section", () => {
    expect(
      buildChanges(
        {
          "config.network.addressMode": { value: "STATIC", base: "DHCP" },
          "config.network.ipv4Config.ip": { value: 0x0a01a8c0, base: 0 },
        },
        cfg(),
      ).config,
    ).toEqual({ network: { addressMode: "STATIC", ipv4Config: { ip: 0x0a01a8c0 } } });
  });

  it("treats changes that can cut MeshTerm off as lockout-class", () => {
    const s = summarize(
      cfg(),
      {
        "config.network.wifiSsid": { value: "cafe", base: "home" },
        "config.network.wifiEnabled": { value: false, base: true },
        "config.security.isManaged": { value: true, base: false },
        "config.lora.hopLimit": { value: 4, base: 3 },
      },
      new Set(["network", "security", "lora"]),
    );
    expect(s.lockout.sort()).toEqual([
      "config.network.wifiEnabled",
      "config.network.wifiSsid",
      "config.security.isManaged",
    ]);
    expect(s.reboot).toBe(true);
  });

  it("validates IPv4 text and admin keys", () => {
    const get = getterFor(cfg(), {});
    expect(validateField("config.network.ipv4Config.ip", "192.168.1", get)).toMatch(/IPv4/);
    expect(validateField("config.network.ipv4Config.ip", 0x0a01a8c0, get)).toBeNull();
    expect(metaFor("config.network.ipv4Config.ip").format?.(0x0a01a8c0)).toBe("192.168.1.10");
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(validateField("config.security.adminKey", [key], get)).toBeNull();
    expect(validateField("config.security.adminKey", ["short"], get)).toMatch(/32 bytes/);
    expect(validateField("config.security.adminKey", [key, key, key, key], get)).toMatch(
      /At most 3/,
    );
  });
});

describe("modules", () => {
  it("get a section each, after the config sections and before backup", () => {
    const ids = allSections(["mqtt", "telemetry"]).map((s) => s.id);
    expect(ids.slice(-4)).toEqual(["module-mqtt", "module-telemetry", "backup", "maintenance"]);
    expect(sectionOf("moduleConfig.mqtt.address")).toBe("module-mqtt");
    expect(isSectionId("module-rangeTest")).toBe(true);
    expect(isSectionId("module-")).toBe(false);
    expect(metaFor("moduleConfig.serial.baud")).toEqual({ label: "Baud" });
    expect(metaFor("moduleConfig.mqtt.password").secret).toBe(true);
  });
});

describe("restoreEdits", () => {
  const source = (over: Partial<RestoreSource> = {}): RestoreSource => ({
    title: "x",
    owner: { id: "!ffffffff", longName: "Old name", shortName: "MTB", hwModel: "TBEAM" },
    config: {
      network: { wifiEnabled: true, wifiSsid: "cabin", addressMode: "DHCP" },
      security: { isManaged: false, publicKey: "b3RoZXI=", privateKey: "b3RoZXI=" },
      lora: { hopLimit: 5 },
    },
    moduleConfig: { mqtt: { enabled: true, address: "" } },
    channels: { list: [{ index: 0, role: "PRIMARY", settings: { name: "Base", psk: "AQ==" } }] },
    fixedPosition: { lat: 1, lon: 2 },
    unknown: [],
    ...over,
  });

  it("lists only what differs, never identity or keys", () => {
    const edits = restoreEdits(source(), getterFor(cfg(), {}));
    expect(edits).toEqual([
      ["owner.longName", "Old name"],
      ["config.network.wifiSsid", "cabin"],
      ["config.lora.hopLimit", 5],
      ["moduleConfig.mqtt.enabled", true],
      ["channels.0.settings.name", "Base"],
      ["config.position.fixedPosition", true],
      ["fixedPosition.lat", 1],
      ["fixedPosition.lon", 2],
    ]);
  });
});
