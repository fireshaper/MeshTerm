import { describe, expect, it } from "vitest";
import { ipv4FromUint32, ipv4ToUint32 } from "./device-config.js";

describe("IPv4 as the firmware's fixed32", () => {
  it("puts the first octet in the lowest byte", () => {
    expect(ipv4ToUint32("192.168.1.10")).toBe(0x0a01a8c0);
    expect(ipv4FromUint32(0x0a01a8c0)).toBe("192.168.1.10");
    expect(ipv4FromUint32(ipv4ToUint32("255.255.255.0") ?? 0)).toBe("255.255.255.0");
  });

  it("refuses what isn't a dotted IPv4 address", () => {
    for (const bad of ["192.168.1", "192.168.1.256", "a.b.c.d", "1.2.3.4.5", ""]) {
      expect(ipv4ToUint32(bad)).toBeNull();
    }
  });
});
