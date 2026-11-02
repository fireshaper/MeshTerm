import { describe, expect, it } from "vitest";
import {
  channelNameHash,
  formatDataRate,
  LORA_PRESETS,
  LORA_REGIONS,
  loraDataRate,
  loraSummary,
  presetTitle,
} from "./lora.js";

describe("loraSummary (CR-005 K1)", () => {
  // Frequencies as the official apps show them for the default channel names.
  it.each([
    ["US", "LONG_FAST", 20, 906.875],
    ["US", "MEDIUM_FAST", 45, 913.125],
    ["US", "MEDIUM_SLOW", 52, 914.875],
    ["US", "SHORT_FAST", 68, 918.875],
    ["US", "LONG_SLOW", 27, 905.3125],
    ["EU_868", "LONG_FAST", 1, 869.525],
  ])("%s %s → slot %i, %f MHz", (region, modemPreset, slot, mhz) => {
    expect(loraSummary({ region, modemPreset })).toMatchObject({ slot, frequencyMhz: mhz });
  });

  it("names the preset with its parameters, defaulting like the proto", () => {
    expect(loraSummary({ region: "US" })).toEqual({
      region: "US",
      preset: "LongFast",
      sf: 11,
      bwKhz: 250,
      cr: 5,
      slot: 20,
      frequencyMhz: 906.875,
    });
  });

  it("uses the primary channel's name, a fixed slot, an override and the offset", () => {
    const named = loraSummary({ region: "US", modemPreset: "LONG_FAST" }, "Friends");
    expect(named.slot).toBe((channelNameHash("Friends") % 104) + 1);
    expect(loraSummary({ region: "US", channelNum: 20 })).toMatchObject({
      slot: 20,
      frequencyMhz: 906.875,
    });
    expect(
      loraSummary({ region: "US", overrideFrequency: 915, frequencyOffset: 0.01 }),
    ).toMatchObject({
      slot: null,
      frequencyMhz: 915.01,
    });
  });

  it("custom modem settings and unknown regions", () => {
    expect(
      loraSummary({
        region: "US",
        usePreset: false,
        bandwidth: 125,
        spreadFactor: 12,
        codingRate: 8,
      }),
    ).toMatchObject({ preset: "Custom", sf: 12, bwKhz: 125, cr: 8 });
    expect(loraSummary({ region: "UNSET" })).toMatchObject({ region: null, frequencyMhz: null });
    expect(loraSummary(null)).toMatchObject({
      region: null,
      preset: "LongFast",
      frequencyMhz: null,
    });
  });
});

describe("preset data rates and region limits", () => {
  it("matches the rates the apps show", () => {
    const rate = (id: string) => {
      const p = LORA_PRESETS[id];
      return p ? formatDataRate(loraDataRate(p)) : null;
    };
    expect(rate("SHORT_TURBO")).toBe("21.9 kbps");
    expect(rate("LONG_FAST")).toBe("1.1 kbps");
    expect(rate("LONG_MODERATE")).toBe("0.34 kbps");
    expect(rate("LONG_SLOW")).toBe("0.18 kbps");
  });

  it("names presets and knows each region's power limit", () => {
    expect(presetTitle("VERY_LONG_SLOW")).toBe("Very Long Slow");
    expect(LORA_REGIONS.US?.powerLimit).toBe(30);
    expect(LORA_REGIONS.EU_868?.powerLimit).toBe(27);
  });
});
