import { readFileSync } from "node:fs";
import { Channel, Config, create, Mesh, ModuleConfig } from "@meshterm/protocol";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { backupFileName, exportYaml, importYaml } from "./backup.js";
import type { ConfigEntry } from "./store.js";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- parsed YAML, checked by the assertions */
type Doc = Record<string, any>;
const KEY = new Uint8Array(32).map((_, i) => i);
const config = (value: Config.Config["payloadVariant"]) =>
  create(Config.ConfigSchema, { payloadVariant: value });

function entry(): ConfigEntry {
  return {
    myNodeNum: 1,
    firmware: "2.7.15",
    owner: create(Mesh.UserSchema, { longName: "MeshTerm Base", shortName: "MTB" }),
    config: new Map([
      [
        "lora",
        config({
          case: "lora",
          value: create(Config.Config_LoRaConfigSchema, {
            usePreset: true,
            region: Config.Config_LoRaConfig_RegionCode.US,
            hopLimit: 3,
          }),
        }),
      ],
      [
        "network",
        config({
          case: "network",
          value: create(Config.Config_NetworkConfigSchema, {
            wifiEnabled: true,
            wifiSsid: "home",
            wifiPsk: "hunter22",
          }),
        }),
      ],
      [
        "security",
        config({
          case: "security",
          value: create(Config.Config_SecurityConfigSchema, { privateKey: KEY, publicKey: KEY }),
        }),
      ],
    ]),
    moduleConfig: new Map([
      [
        "mqtt",
        create(ModuleConfig.ModuleConfigSchema, {
          payloadVariant: {
            case: "mqtt",
            value: create(ModuleConfig.ModuleConfig_MQTTConfigSchema, {
              enabled: true,
              password: "large4cats",
            }),
          },
        }),
      ],
    ]),
    channels: new Map([
      [
        0,
        create(Channel.ChannelSchema, {
          index: 0,
          role: Channel.Channel_Role.PRIMARY,
          settings: create(Channel.ChannelSettingsSchema, { psk: new Uint8Array([1]) }),
        }),
      ],
    ]),
    receivedAt: 0,
  };
}

describe("exportYaml", () => {
  it("writes the CLI layout without secrets by default", () => {
    const text = exportYaml(entry(), { secrets: false, location: null });
    expect(text.startsWith("# start of Meshtastic configure yaml\n")).toBe(true);
    const doc = parse(text) as Doc;
    expect(doc.owner).toBe("MeshTerm Base");
    expect(doc.owner_short).toBe("MTB");
    expect(doc.channel_url).toBeUndefined();
    expect(doc.config.lora).toEqual({ use_preset: true, region: "US", hop_limit: 3 });
    expect(doc.config.network).toEqual({ wifi_enabled: true, wifi_ssid: "home" });
    expect(doc.config.security.private_key).toBeUndefined();
    expect(doc.config.security.public_key).toBe(`base64:${Buffer.from(KEY).toString("base64")}`);
    expect(doc.module_config.mqtt).toEqual({ enabled: true });
    expect(text).not.toContain("hunter22");
    expect(text).not.toContain("large4cats");
  });

  it("includes secrets, the channel link and the fixed position when asked", () => {
    const text = exportYaml(entry(), { secrets: true, location: { lat: 1.5, lon: 2.5, alt: 3 } });
    const doc = parse(text) as Doc;
    expect(doc.channel_url).toMatch(/^https:\/\/meshtastic\.org\/e\/#/);
    expect(doc.config.network.wifi_psk).toBe("hunter22");
    expect(doc.config.security.private_key).toMatch(/^base64:/);
    expect(doc.location).toEqual({ lat: 1.5, lon: 2.5, alt: 3 });
  });

  it("reads back what it wrote", () => {
    const back = importYaml(exportYaml(entry(), { secrets: true, location: null }));
    expect(back.unknown).toEqual([]);
    expect(back.owner).toEqual({ longName: "MeshTerm Base", shortName: "MTB" });
    expect(back.config.lora).toMatchObject({ region: "US", hopLimit: 3, usePreset: true });
    expect(back.config.security?.privateKey).toBe(Buffer.from(KEY).toString("base64"));
    expect(back.moduleConfig.mqtt).toMatchObject({ enabled: true, password: "large4cats" });
    expect(back.channels?.settings).toEqual([expect.objectContaining({ psk: "AQ==" })]);
  });
});

describe("importYaml", () => {
  it("reads a CLI export: camelCase, base64: bytes, location; lists unknown keys", () => {
    const back = importYaml(
      readFileSync(new URL("./fixtures/cli-export.yaml", import.meta.url), "utf8"),
    );
    expect(back.owner).toEqual({ longName: "Test Node", shortName: "TST" });
    expect(back.config.lora).toMatchObject({
      region: "US",
      txPower: 30,
      sx126xRxBoostedGain: true,
    });
    expect(back.config.bluetooth).toMatchObject({ enabled: true, fixedPin: 123456 });
    expect(back.config.security).toMatchObject({
      serialEnabled: true,
      adminKey: [""],
      publicKey: "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8=",
    });
    expect(back.moduleConfig.mqtt).toMatchObject({ username: "meshdev", encryptionEnabled: true });
    expect(back.moduleConfig.ambientLighting).toMatchObject({ current: 10 });
    expect(back.fixedPosition).toEqual({ lat: 35.25, lon: -80.5, alt: 100 });
    expect(back.channels?.settings).toHaveLength(1);
    expect([...back.unknown].sort()).toEqual([
      "canned_messages",
      "config.security.someFutureFlag",
      "ringtone",
    ]);
  });

  it("takes snake_case too, and refuses what isn't a config file", () => {
    expect(importYaml("config:\n  lora:\n    hop_limit: 5\n").config.lora).toMatchObject({
      hopLimit: 5,
    });
    expect(() => importYaml("- a\n- b\n")).toThrow(/not a Meshtastic config/);
    expect(() => importYaml("config:\n  lora:\n    hop_limit: lots\n")).toThrow(/config.lora/);
    expect(() => importYaml("a: [")).toThrow(/not YAML/);
  });

  it("names the file after the node and the date", () => {
    expect(backupFileName("MTB", Date.UTC(2026, 9, 21))).toBe("meshterm-MTB-2026-10-21.yaml");
    expect(backupFileName("🚀", 0)).toBe("meshterm-node-1970-01-01.yaml");
  });
});
