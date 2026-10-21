import { Channel, Config, create } from "@meshterm/protocol";
import { describe, expect, it } from "vitest";
import { encodeChannelUrl, parseChannelUrl, qrCode, randomPsk } from "./channel-url.js";

const settings = (name: string, psk: number[]) =>
  create(Channel.ChannelSettingsSchema, { name, psk: new Uint8Array(psk) });

describe("channel links", () => {
  it("encodes the default channel exactly as the apps do", () => {
    // ChannelSet { settings: [{ psk: 0x01 }] }: field 1 (len 3) → field 2 (len 1) = 0x01.
    expect(encodeChannelUrl([settings("", [1])], null)).toBe("https://meshtastic.org/e/#CgMSAQE");
  });

  it("round-trips channels and LoRa settings", () => {
    const lora = create(Config.Config_LoRaConfigSchema, {
      usePreset: true,
      region: Config.Config_LoRaConfig_RegionCode.EU_868,
      hopLimit: 3,
      txEnabled: true,
    });
    const key = Array.from({ length: 32 }, (_, i) => i);
    const url = encodeChannelUrl([settings("", [1]), settings("Friends", key)], lora);
    const parsed = parseChannelUrl(url);
    expect(parsed.add).toBe(false);
    expect(parsed.settings.map((s) => s.name)).toEqual(["", "Friends"]);
    expect(parsed.settings[1]?.psk).toBe(Buffer.from(key).toString("base64"));
    expect(parsed.lora).toMatchObject({ region: "EU_868", hopLimit: 3, usePreset: true });
  });

  it("accepts ?add=true links, padded standard base64 and surrounding spaces", () => {
    const parsed = parseChannelUrl("  https://meshtastic.org/e/?add=true#CgMSAQE=  ");
    expect(parsed).toMatchObject({ add: true, lora: null, settings: [{ psk: "AQ==" }] });
  });

  it("refuses what isn't a channel link", () => {
    expect(() => parseChannelUrl("https://meshtastic.org/")).toThrow(/no # part/);
    expect(() => parseChannelUrl("https://meshtastic.org/e/#$$$")).toThrow(/bad encoding/);
    expect(() => parseChannelUrl("https://meshtastic.org/e/#")).toThrow();
    expect(() => parseChannelUrl("https://meshtastic.org/e/#_w")).toThrow();
  });
});

describe("qrCode and randomPsk", () => {
  it("draws a QR code as rectangles in a square viewBox", () => {
    const qr = qrCode("https://meshtastic.org/e/#CgMSAQE");
    expect(qr.size).toBeGreaterThanOrEqual(21 + 4);
    expect(qr.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });

  it("makes keys of the requested length, never the same twice", () => {
    expect(Buffer.from(randomPsk(128), "base64")).toHaveLength(16);
    expect(Buffer.from(randomPsk(256), "base64")).toHaveLength(32);
    expect(randomPsk(256)).not.toBe(randomPsk(256));
  });
});
