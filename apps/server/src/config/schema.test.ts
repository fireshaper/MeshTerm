import { describe, expect, it } from "vitest";
import { configSchema } from "./schema.js";

describe("configSchema", () => {
  it("describes sections, enums, nested messages and lists by reflection", () => {
    const s = configSchema();
    expect(Object.keys(s.config)).toEqual(
      expect.arrayContaining(["device", "lora", "bluetooth", "security"]),
    );
    expect(Object.keys(s.moduleConfig)).toEqual(expect.arrayContaining(["mqtt", "telemetry"]));
    const lora = s.config.lora ?? [];
    expect(lora.find((f) => f.name === "hopLimit")).toEqual({
      name: "hopLimit",
      kind: "uint",
      list: false,
    });
    expect(lora.find((f) => f.name === "txPower")?.kind).toBe("int");
    expect(lora.find((f) => f.name === "region")?.enumValues).toContain("EU_868");
    expect(lora.find((f) => f.name === "ignoreIncoming")).toMatchObject({
      kind: "uint",
      list: true,
    });
    expect(s.owner.find((f) => f.name === "isLicensed")?.kind).toBe("bool");
    const settings = s.channel.find((f) => f.name === "settings");
    expect(settings?.kind).toBe("message");
    expect(settings?.fields?.find((f) => f.name === "psk")?.kind).toBe("bytes");
  });
});
