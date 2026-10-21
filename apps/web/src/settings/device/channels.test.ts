import type { DeviceConfigDTO, ParsedChannelUrlDTO } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import { importEdits } from "./ChannelLinkDialogs.js";
import {
  buildChanges,
  getterFor,
  nodeValue,
  summarize,
  type ConfigView,
  type Edit,
} from "./edits.js";
import { labelFor } from "./format.js";
import { metaFor, precisionRadius, pskBytes, validateField } from "./registry.js";

const channel = (index: number, role: string, name: string, psk: string) => ({
  index,
  role,
  settings: {
    name,
    psk,
    uplinkEnabled: false,
    downlinkEnabled: false,
    moduleSettings: { positionPrecision: 13 },
  },
});

const cfg = (): ConfigView => ({
  connectionId: 1,
  version: "v1",
  receivedAt: 0,
  myNodeNum: 1,
  firmware: null,
  owner: { shortName: "MTB" },
  config: { lora: { region: "US", hopLimit: 3 }, position: { fixedPosition: false } },
  moduleConfig: {},
  channels: [
    channel(0, "PRIMARY", "", "AQ=="),
    channel(1, "SECONDARY", "Friends", "a2V5a2V5a2V5a2V5a2V5aw=="),
  ],
  secretsMasked: false,
  fixedPosition: { lat: 47.5, lon: -122.25 },
});

describe("channel paths", () => {
  it("reads nested channel values; unreported slots are empty", () => {
    expect(nodeValue(cfg(), "channels.1.settings.name")).toBe("Friends");
    expect(nodeValue(cfg(), "channels.1.settings.moduleSettings.positionPrecision")).toBe(13);
    expect(nodeValue(cfg(), "channels.5.role")).toBeUndefined();
    expect(nodeValue(cfg(), "fixedPosition.lat")).toBe(47.5);
    expect(metaFor("channels.3.settings.name").label).toBe("Name");
    expect(labelFor("channels.1.settings.psk", getterFor(cfg(), {}))).toBe("#1 Friends · Key");
  });

  it("sends whole channels with the edits on top, new slots from scratch", () => {
    const edits: Record<string, Edit> = {
      "channels.1.settings.name": { value: "Hikers", base: "Friends" },
      "channels.2.role": { value: "SECONDARY", base: undefined },
      "channels.2.settings.psk": { value: "AQ==", base: undefined },
    };
    expect(buildChanges(edits, cfg()).channels).toEqual([
      { ...channel(1, "SECONDARY", "Hikers", "a2V5a2V5a2V5a2V5a2V5aw==") },
      { index: 2, role: "SECONDARY", settings: { psk: "AQ==" } },
    ]);
  });

  it("validates keys and names, and warns about public or missing keys", () => {
    const get = getterFor(cfg(), {});
    expect(pskBytes("AQ==")).toBe(1);
    expect(pskBytes("a2V5a2V5a2V5a2V5a2V5aw==")).toBe(16);
    expect(validateField("channels.1.settings.psk", "AAAA", get)).toMatch(/16 or 32 bytes/);
    expect(validateField("channels.1.settings.psk", "not base64!", get)).toBe("Not base64.");
    expect(validateField("channels.1.settings.name", "twelve chars", get)).toMatch(/11 bytes/);
    expect(metaFor("channels.1.settings.psk").warning?.("", get)).toMatch(/unencrypted/);
    expect(precisionRadius(14)).toBe("~1.5 km");
    expect(precisionRadius(0)).toBe("No position shared");
  });
});

describe("fixed position", () => {
  it("sends the coordinates when turned on, null when turned off", () => {
    const on = { "config.position.fixedPosition": { value: true, base: false } };
    expect(buildChanges(on, cfg()).fixedPosition).toEqual({ lat: 47.5, lon: -122.25 });
    const moved = { ...on, "fixedPosition.lat": { value: 48, base: 47.5 } };
    expect(buildChanges(moved, cfg()).fixedPosition).toEqual({ lat: 48, lon: -122.25 });
    const base = cfg();
    base.config.position = { fixedPosition: true };
    const off = { "config.position.fixedPosition": { value: false, base: true } };
    expect(buildChanges(off, base).fixedPosition).toBeNull();
  });

  it("needs coordinates", () => {
    const noFix: ConfigView = { ...cfg(), fixedPosition: null };
    const s = summarize(
      noFix,
      { "config.position.fixedPosition": { value: true, base: false } },
      new Set(),
    );
    expect(s.invalid).toEqual(["fixedPosition.lat", "fixedPosition.lon"]);
  });
});

describe("importEdits", () => {
  const link: ParsedChannelUrlDTO = {
    settings: [
      { name: "", psk: "AQ==" },
      { name: "Ops", psk: "b3BzLWtleS1vcHMta2V5IQ==" },
    ],
    lora: { region: "EU_868", hopLimit: 3 },
    add: false,
  };
  const get = getterFor(cfg(), {});

  it("adds new channels to free slots, skipping ones already there", () => {
    expect(importEdits(link, "add", false, get)).toEqual([
      ["channels.2.role", "SECONDARY"],
      ["channels.2.settings.name", "Ops"],
      ["channels.2.settings.psk", "b3BzLWtleS1vcHMta2V5IQ=="],
    ]);
  });

  it("replaces: the link's channels become 0…, the rest disabled; LoRa if asked", () => {
    expect(importEdits(link, "replace", true, get)).toEqual([
      ["channels.1.settings.name", "Ops"],
      ["channels.1.settings.psk", "b3BzLWtleS1vcHMta2V5IQ=="],
      ["config.lora.region", "EU_868"],
    ]);
  });

  it("refuses when there aren't enough free slots", () => {
    const full: DeviceConfigDTO = {
      ...cfg(),
      channels: [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        channel(i, i ? "SECONDARY" : "PRIMARY", `c${i}`, "AQ=="),
      ),
    };
    expect(() => importEdits(link, "add", false, getterFor(full, {}))).toThrow(/slots are free/);
  });
});
