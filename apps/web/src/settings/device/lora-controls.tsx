// The LoRa section's own controls (CR-005 K6): the frequency readout, preset cards on a
// faster ↔ farther scale, a TX power slider bounded by the region's limit and a hop stepper.
// Each plugs into `ConfigField` through `renderInput`, so labels, "changed", "was:",
// warnings and reset work as for every other field.
import {
  formatDataRate,
  LORA_PRESETS,
  LORA_REGIONS,
  loraDataRate,
  loraSummary,
  presetTitle,
  type FieldSchema,
} from "@meshterm/shared";
import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { InputCommon } from "./ConfigField.js";
import { metaFor, type Getter } from "./registry.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

export interface CustomInputProps {
  common: InputCommon;
  field: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  get: Getter;
}

/** The TX power limit (dBm) of the region being set; the firmware's US limit without one. */
export function regionPowerLimit(get: Getter): number {
  const region = get("config.lora.region");
  return (typeof region === "string" && LORA_REGIONS[region]?.powerLimit) || 30;
}

/** Presets the node offers, fastest first, with their modem settings and data rate. */
export function presetOptions(field: FieldSchema, current: unknown) {
  const hidden = metaFor("config.lora.modemPreset").hiddenValues ?? [];
  return (field.enumValues ?? [])
    .filter((id) => id === current || !hidden.includes(id))
    .flatMap((id) => {
      const info = LORA_PRESETS[id];
      return info ? [{ id, info, rate: loraDataRate(info) }] : [];
    })
    .sort((a, b) => b.rate - a.rate);
}

function PresetCards({ common, field, value, onChange }: CustomInputProps) {
  return (
    <div data-mt="preset-cards">
      <div
        role="radiogroup"
        data-mt="preset-options"
        aria-labelledby={`${common.id}-label`}
        aria-describedby={common["aria-describedby"]}
      >
        {presetOptions(field, value).map(({ id, info, rate }) => {
          const checked = id === value;
          return (
            <label key={id} data-mt="preset-card" data-mt-state={checked ? "active" : "idle"}>
              <input
                type="radio"
                name={common.id}
                value={id}
                checked={checked}
                disabled={common.disabled}
                onChange={() => {
                  onChange(id);
                }}
              />
              <span data-mt="preset-card-name">{presetTitle(id)}</span>{" "}
              <span data-mt="preset-card-modem">
                SF{info.sf} · {info.bwKhz} kHz
              </span>{" "}
              <span data-mt="preset-card-rate">{formatDataRate(rate)}</span>
            </label>
          );
        })}
      </div>
      <p data-mt="preset-scale">
        <span>Faster, shorter range</span>
        <span data-mt="preset-scale-line" aria-hidden="true" />
        <span>Slower, longer range</span>
      </p>
    </div>
  );
}

function TxPower({ common, value, onChange, get }: CustomInputProps) {
  const limit = regionPowerLimit(get);
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return (
    <div data-mt="tx-power">
      <input
        type="range"
        min={0}
        max={limit}
        step={1}
        value={Math.min(n, limit)}
        disabled={common.disabled}
        aria-label="TX power"
        aria-valuetext={n === 0 ? "Region default" : `${n} dBm`}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
      />
      <input
        type="number"
        {...common}
        min={0}
        max={limit}
        step={1}
        value={typeof value === "number" && Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          onChange(e.target.value.trim() === "" ? Number.NaN : Number(e.target.value));
        }}
      />
      <span data-mt="tx-power-limit">limit {limit} dBm</span>
    </div>
  );
}

function HopStepper({ common, value, onChange }: CustomInputProps) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 3;
  return (
    <div data-mt="stepper">
      <button
        type="button"
        data-mt="stepper-button"
        aria-label="Fewer hops"
        disabled={common.disabled || n <= 0}
        onClick={() => {
          onChange(n - 1);
        }}
      >
        <Minus data-mt="icon" {...ICON} />
      </button>
      <input
        type="number"
        {...common}
        min={0}
        max={7}
        step={1}
        value={typeof value === "number" && Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          onChange(e.target.value.trim() === "" ? Number.NaN : Number(e.target.value));
        }}
      />
      <button
        type="button"
        data-mt="stepper-button"
        aria-label="More hops"
        disabled={common.disabled || n >= 7}
        onClick={() => {
          onChange(n + 1);
        }}
      >
        <Plus data-mt="icon" {...ICON} />
      </button>
    </div>
  );
}

/** Fields with their own input. */
export const CUSTOM_INPUTS: Readonly<Record<string, (props: CustomInputProps) => ReactNode>> = {
  "config.lora.modemPreset": PresetCards,
  "config.lora.txPower": TxPower,
  "config.lora.hopLimit": HopStepper,
};

/** Where the radio ends up: frequency, slot and where the slot comes from. */
export function frequencyText(get: Getter): { value: string; source: string } {
  const lora = {
    region: get("config.lora.region"),
    usePreset: get("config.lora.usePreset"),
    modemPreset: get("config.lora.modemPreset"),
    bandwidth: get("config.lora.bandwidth"),
    spreadFactor: get("config.lora.spreadFactor"),
    codingRate: get("config.lora.codingRate"),
    channelNum: get("config.lora.channelNum"),
    overrideFrequency: get("config.lora.overrideFrequency"),
    frequencyOffset: get("config.lora.frequencyOffset"),
  };
  const primary = get("channels.0.settings.name");
  const name = typeof primary === "string" ? primary : "";
  const s = loraSummary(lora, name);
  if (s.frequencyMhz === null) {
    return {
      value: "— MHz",
      source: s.region === null ? "Set a region to pick a frequency" : "Set the bandwidth",
    };
  }
  const value = `${String(s.frequencyMhz)} MHz`;
  if (s.slot === null) return { value, source: "set by the frequency override" };
  const chosen = typeof lora.channelNum === "number" && lora.channelNum > 0;
  if (chosen) return { value, source: `slot ${String(s.slot)} · set by hand` };
  return {
    value,
    source: name
      ? `slot ${String(s.slot)} · picked from the primary channel name “${name}”`
      : `slot ${String(s.slot)} · picked from the preset name “${s.preset ?? ""}”`,
  };
}

/** Shown after the "Use a modem preset" field. */
export function LoraFrequency({ get }: { get: Getter }) {
  const { value, source } = frequencyText(get);
  return (
    <p data-mt="lora-frequency" aria-live="polite">
      <strong data-mt="lora-frequency-value">{value}</strong>
      <span data-mt="lora-frequency-source">{source}</span>
    </p>
  );
}

/** Extra content after a field (by path). */
export function afterField(path: string, get: Getter): ReactNode {
  return path === "config.lora.usePreset" ? <LoraFrequency get={get} /> : null;
}
