// LoRa radio settings as people read them (CR-005 K1): the modem preset's parameters,
// the region's band, and the frequency the node actually uses, worked out the way the
// Meshtastic firmware does (RadioInterface::applyModemConfig).

export interface PresetInfo {
  /** The firmware's display name, also the default primary channel name. */
  name: string;
  /** Spreading factor. */
  sf: number;
  /** Bandwidth in kHz. */
  bwKhz: number;
  /** Coding rate denominator (4/x). */
  cr: number;
}

export const LORA_PRESETS: Readonly<Record<string, PresetInfo>> = {
  SHORT_TURBO: { name: "ShortTurbo", sf: 7, bwKhz: 500, cr: 5 },
  SHORT_FAST: { name: "ShortFast", sf: 7, bwKhz: 250, cr: 5 },
  SHORT_SLOW: { name: "ShortSlow", sf: 8, bwKhz: 250, cr: 5 },
  MEDIUM_FAST: { name: "MediumFast", sf: 9, bwKhz: 250, cr: 5 },
  MEDIUM_SLOW: { name: "MediumSlow", sf: 10, bwKhz: 250, cr: 5 },
  LONG_FAST: { name: "LongFast", sf: 11, bwKhz: 250, cr: 5 },
  LONG_MODERATE: { name: "LongMod", sf: 11, bwKhz: 125, cr: 8 },
  LONG_SLOW: { name: "LongSlow", sf: 12, bwKhz: 125, cr: 8 },
  VERY_LONG_SLOW: { name: "VLongSlow", sf: 12, bwKhz: 62.5, cr: 8 },
  LONG_TURBO: { name: "LongTurbo", sf: 11, bwKhz: 500, cr: 8 },
};

/** Band edges in MHz and channel spacing in MHz, from the firmware's region table. */
export const LORA_REGIONS: Readonly<
  Record<string, { start: number; end: number; spacing: number }>
> = {
  US: { start: 902, end: 928, spacing: 0 },
  EU_433: { start: 433, end: 434, spacing: 0 },
  EU_868: { start: 869.4, end: 869.65, spacing: 0 },
  CN: { start: 470, end: 510, spacing: 0 },
  JP: { start: 920.5, end: 923.5, spacing: 0 },
  ANZ: { start: 915, end: 928, spacing: 0 },
  KR: { start: 920, end: 923, spacing: 0 },
  TW: { start: 920, end: 925, spacing: 0 },
  RU: { start: 868.7, end: 869.2, spacing: 0 },
  IN: { start: 865, end: 867, spacing: 0 },
  NZ_865: { start: 864, end: 868, spacing: 0 },
  TH: { start: 920, end: 925, spacing: 0 },
  UA_433: { start: 433, end: 434.7, spacing: 0 },
  UA_868: { start: 868, end: 868.6, spacing: 0 },
  MY_433: { start: 433, end: 435, spacing: 0 },
  MY_919: { start: 919, end: 924, spacing: 0 },
  SG_923: { start: 917, end: 925, spacing: 0 },
  LORA_24: { start: 2400, end: 2483.5, spacing: 0 },
};

/** The firmware's channel-name hash (djb2 over the UTF-8 bytes, 32-bit). */
export function channelNameHash(name: string): number {
  let hash = 5381;
  for (const byte of new TextEncoder().encode(name)) hash = (Math.imul(hash, 33) + byte) >>> 0;
  return hash;
}

/** The parts of `config.lora` (proto JSON) this reads; anything else is ignored. */
export interface LoraSettings {
  region?: unknown;
  usePreset?: unknown;
  modemPreset?: unknown;
  bandwidth?: unknown;
  spreadFactor?: unknown;
  codingRate?: unknown;
  channelNum?: unknown;
  overrideFrequency?: unknown;
  frequencyOffset?: unknown;
}

export interface LoraSummary {
  region: string | null;
  /** The preset's display name ("LongFast"), or "Custom" without a preset. */
  preset: string | null;
  sf: number | null;
  bwKhz: number | null;
  cr: number | null;
  /** 1-based frequency slot, as the apps show it; null with an override or unknown region. */
  slot: number | null;
  /** MHz, null when it can't be worked out. */
  frequencyMhz: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Region, preset and frequency from the node's LoRa config and its primary channel's
 * name (empty: the preset's name, like the firmware). Missing fields use the proto
 * defaults (`LONG_FAST`, presets on).
 */
export function loraSummary(lora: LoraSettings | null, primaryChannelName = ""): LoraSummary {
  const region = typeof lora?.region === "string" && lora.region !== "UNSET" ? lora.region : null;
  const usePreset = lora?.usePreset !== false;
  const presetId = typeof lora?.modemPreset === "string" ? lora.modemPreset : "LONG_FAST";
  const preset = usePreset ? (LORA_PRESETS[presetId] ?? null) : null;
  const custom = {
    sf: num(lora?.spreadFactor),
    bwKhz: num(lora?.bandwidth),
    cr: num(lora?.codingRate),
  };
  const sf = preset ? preset.sf : custom.sf;
  const bwKhz = preset ? preset.bwKhz : custom.bwKhz;
  const cr = preset ? preset.cr : custom.cr;
  const base: LoraSummary = {
    region,
    preset: preset ? preset.name : usePreset ? null : "Custom",
    sf,
    bwKhz,
    cr,
    slot: null,
    frequencyMhz: null,
  };

  const offset = num(lora?.frequencyOffset) ?? 0;
  const override = num(lora?.overrideFrequency);
  if (override !== null && override > 0) return { ...base, frequencyMhz: round(override + offset) };

  const band = region ? LORA_REGIONS[region] : undefined;
  if (!band || !bwKhz) return base;
  const bw = bwKhz / 1000;
  const channels = Math.max(
    1,
    Math.round((band.end - band.start + band.spacing) / (band.spacing + bw)),
  );
  const chosen = num(lora?.channelNum) ?? 0;
  const name = primaryChannelName || preset?.name || "";
  const index = chosen > 0 ? (chosen - 1) % channels : channelNameHash(name) % channels;
  const frequency = band.start + bw / 2 + index * (bw + band.spacing);
  return { ...base, slot: index + 1, frequencyMhz: round(frequency + offset) };
}

const round = (mhz: number) => Math.round(mhz * 10_000) / 10_000;
