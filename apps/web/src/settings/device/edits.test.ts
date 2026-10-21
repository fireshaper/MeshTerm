import type { DeviceConfigDTO } from "@meshterm/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { buildChanges, nodeValue, summarize, useEditsStore } from "./edits.js";
import { humanize, validateField } from "./registry.js";

const cfg = (lora: Record<string, unknown> = {}): DeviceConfigDTO => ({
  connectionId: 1,
  version: "v1",
  receivedAt: 0,
  myNodeNum: 1,
  firmware: "2.6.0",
  owner: { longName: "Base", shortName: "BASE", isLicensed: false },
  config: {
    lora: { region: "US", hopLimit: 3, usePreset: true, ...lora },
    device: { role: "CLIENT", isManaged: false },
    display: { screenOnSecs: 60 },
  },
  moduleConfig: {},
  channels: [],
  secretsMasked: false,
});
const REBOOTS = new Set(["lora", "device"]);

beforeEach(() => {
  useEditsStore.setState({ connectionId: null, edits: {}, applyId: null });
});

describe("edits store", () => {
  it("keeps the original base and drops an edit set back to it", () => {
    const { set } = useEditsStore.getState();
    set(1, "config.lora.hopLimit", 4, 3);
    set(1, "config.lora.hopLimit", 5, 4);
    expect(useEditsStore.getState().edits["config.lora.hopLimit"]).toEqual({ value: 5, base: 3 });
    set(1, "config.lora.hopLimit", 3, 3);
    expect(useEditsStore.getState().edits).toEqual({});
  });

  it("starts over for another connection", () => {
    const { set } = useEditsStore.getState();
    set(1, "config.lora.hopLimit", 4, 3);
    set(2, "owner.longName", "X", "Y");
    expect(Object.keys(useEditsStore.getState().edits)).toEqual(["owner.longName"]);
  });
});

describe("buildChanges", () => {
  it("nests edits into partial sections", () => {
    expect(
      buildChanges({
        "owner.longName": { value: "New", base: "Old" },
        "config.lora.hopLimit": { value: 4, base: 3 },
        "config.lora.txPower": { value: 20, base: 0 },
        "config.display.units": { value: "IMPERIAL", base: "METRIC" },
      }),
    ).toEqual({
      owner: { longName: "New" },
      config: { lora: { hopLimit: 4, txPower: 20 }, display: { units: "IMPERIAL" } },
    });
  });
});

describe("summarize", () => {
  it("counts by section and knows when the node reboots", () => {
    const s = summarize(
      cfg(),
      {
        "config.display.screenOnSecs": { value: 30, base: 60 },
        "owner.longName": { value: "New", base: "Base" },
      },
      REBOOTS,
    );
    expect(s).toMatchObject({ count: 2, bySection: { display: 1, user: 1 }, reboot: false });
    const t = summarize(cfg(), { "config.lora.hopLimit": { value: 4, base: 3 } }, REBOOTS);
    expect(t.reboot).toBe(true);
  });

  it("flags invalid values, conflicts and lockout-class changes", () => {
    const s = summarize(
      cfg({ hopLimit: 5 }),
      {
        "config.lora.hopLimit": { value: 9, base: 3 },
        "config.device.isManaged": { value: true, base: false },
        "owner.shortName": { value: "TOOLONG", base: "BASE" },
      },
      REBOOTS,
    );
    expect(s.invalid).toEqual(["config.lora.hopLimit", "owner.shortName"]);
    expect(s.conflicts).toEqual(["config.lora.hopLimit"]);
    expect(s.lockout).toEqual(["config.device.isManaged"]);
  });

  it("blocks LoRa changes while the region is unset", () => {
    const s = summarize(
      cfg({ region: "UNSET" }),
      { "config.lora.hopLimit": { value: 4, base: 3 } },
      REBOOTS,
    );
    expect(s.invalid).toEqual(["config.lora.region"]);
  });
});

describe("registry", () => {
  it("reads values by path and checks ranges and byte lengths", () => {
    expect(nodeValue(cfg(), "config.lora.hopLimit")).toBe(3);
    expect(nodeValue(cfg(), "owner.shortName")).toBe("BASE");
    const get = () => undefined;
    expect(validateField("config.lora.hopLimit", 8, get)).toBe("At most 7.");
    expect(validateField("config.lora.hopLimit", Number.NaN, get)).toBe("Enter a number.");
    // Four bytes, however many characters: an emoji is four on its own.
    expect(validateField("owner.shortName", "🚀", get)).toBeNull();
    expect(validateField("owner.shortName", "🚀a", get)).toMatch(/At most 4 bytes/);
    expect(humanize("nodeInfoBroadcastSecs")).toBe("Node info broadcast secs");
  });
});
