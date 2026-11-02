// The Device page's section tiles (CR-005 K6): an icon and a one-line summary per section,
// from the node's settings (with pending edits) where a line says more than the registry's.
import { presetTitle } from "@meshterm/shared";
import {
  ArchiveRestore,
  BatteryMedium,
  Bluetooth,
  Cpu,
  Hash,
  KeyRound,
  MapPin,
  Monitor,
  Network,
  Puzzle,
  RadioTower,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { formatValue } from "./format.js";
import type { Getter, SectionMeta } from "./registry.js";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  user: UserRound,
  device: Cpu,
  lora: RadioTower,
  channels: Hash,
  position: MapPin,
  power: BatteryMedium,
  network: Network,
  display: Monitor,
  bluetooth: Bluetooth,
  security: KeyRound,
  backup: ArchiveRestore,
  maintenance: Wrench,
};

export const sectionIcon = (section: SectionMeta): LucideIcon =>
  ICONS[section.id] ?? (section.kind === "module" ? Puzzle : Cpu);

const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** A section's line under its tile title. */
export function sectionSummary(section: SectionMeta, get: Getter): string {
  switch (section.id) {
    case "user": {
      const long = text(get("owner.longName"));
      const short = text(get("owner.shortName"));
      const name = long && short ? `${long} (${short})` : (long ?? short);
      return name
        ? `${name}${get("owner.isLicensed") === true ? " · licensed" : ""}`
        : section.summary;
    }
    case "device":
      return formatValue("config.device.role", get("config.device.role") ?? "CLIENT");
    case "lora": {
      const region = get("config.lora.region") ?? "UNSET";
      if (typeof region !== "string") return section.summary;
      const preset =
        get("config.lora.usePreset") === false
          ? "Custom modem"
          : presetTitle(text(get("config.lora.modemPreset")) ?? "LONG_FAST");
      const hops = get("config.lora.hopLimit");
      const regionText = region === "UNSET" ? "No region" : region;
      return `${regionText} · ${preset}${typeof hops === "number" ? ` · ${String(hops)} hops` : ""}`;
    }
    case "channels": {
      let used = 0;
      for (let i = 0; i < 8; i++) {
        const role = get(`channels.${String(i)}.role`);
        if (role === "PRIMARY" || role === "SECONDARY") used++;
      }
      return used > 0 ? `${String(used)} of 8 slots in use` : section.summary;
    }
    case "position":
      return get("config.position.fixedPosition") === true
        ? "Fixed position · broadcast, GPS"
        : section.summary;
    default:
      return section.summary;
  }
}
