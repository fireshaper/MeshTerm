import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECRET_MASK } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import { deepMerge, diffPaths, leafPaths, verify } from "./applier.js";
import { decrypt, encrypt, loadSecretKey, parseSecretKey } from "./snapshots.js";
import { isSecretPath, maskSecrets } from "./store.js";

describe("merging and paths", () => {
  it("deepMerge merges objects and replaces everything else", () => {
    expect(deepMerge({ a: 1, b: { c: 2, d: 3 }, e: [1, 2] }, { b: { c: 9 }, e: [3] })).toEqual({
      a: 1,
      b: { c: 9, d: 3 },
      e: [3],
    });
  });

  it("leafPaths and diffPaths name the fields that change", () => {
    expect(leafPaths({ lora: { hopLimit: 4, region: "US" } }, "config")).toEqual([
      "config.lora.hopLimit",
      "config.lora.region",
    ]);
    expect(
      diffPaths(
        { settings: { name: "a", psk: "x" }, role: "SECONDARY" },
        { settings: { name: "b", psk: "x" }, role: "SECONDARY" },
        "channels.1",
      ),
    ).toEqual(["channels.1.settings.name"]);
  });
});

describe("secrets", () => {
  it("knows which paths are secret", () => {
    expect(isSecretPath("config.network.wifiPsk")).toBe(true);
    expect(isSecretPath("channels.*.settings.psk")).toBe(true);
    expect(isSecretPath("channels.3.settings.psk")).toBe(true);
    expect(isSecretPath("config.lora.hopLimit")).toBe(false);
  });

  it("maskSecrets hides set secrets and leaves empty ones empty", () => {
    const masked = maskSecrets({
      owner: null,
      config: { network: { wifiPsk: "hunter2" }, security: { privateKey: "" } },
      moduleConfig: { mqtt: { password: "pw" } },
      channels: [{ index: 0, settings: { psk: "AQ==", name: "" } }],
    });
    expect(masked.config.network).toEqual({ wifiPsk: SECRET_MASK });
    expect(masked.config.security).toEqual({ privateKey: "" });
    expect(masked.moduleConfig.mqtt).toEqual({ password: SECRET_MASK });
    expect(masked.channels[0]?.settings).toEqual({ psk: SECRET_MASK, name: "" });
  });

  it("verify reports mismatches with secret values masked", () => {
    const intended = {
      owner: null,
      config: { lora: { txPower: 30 } },
      moduleConfig: {},
      channels: [{ index: 1, settings: { psk: "new" } }],
    };
    const actual = {
      owner: null,
      config: { lora: { txPower: 20 } },
      moduleConfig: {},
      channels: [{ index: 1, settings: { psk: "old" } }],
    };
    expect(verify(intended, actual, ["config.lora.txPower", "channels.1.settings.psk"])).toEqual([
      { path: "config.lora.txPower", sent: 30, actual: 20 },
      { path: "channels.1.settings.psk", sent: SECRET_MASK, actual: SECRET_MASK },
    ]);
  });
});

describe("snapshot encryption", () => {
  it("round-trips with AES-256-GCM and refuses tampering or another key", () => {
    const key = randomBytes(32);
    const sealed = encrypt(key, '{"psk":"AQ=="}');
    expect(sealed).not.toContain("AQ==");
    expect(decrypt(key, sealed)).toBe('{"psk":"AQ=="}');
    expect(() => decrypt(randomBytes(32), sealed)).toThrow();
    const raw = Buffer.from(sealed, "base64");
    raw[raw.length - 1] = (raw.at(-1) ?? 0) ^ 1;
    expect(() => decrypt(key, raw.toString("base64"))).toThrow();
  });

  it("reads the key from the environment (base64 or hex) or creates one in the data dir", () => {
    const k = randomBytes(32);
    expect(parseSecretKey(k.toString("base64"))).toEqual(k);
    expect(parseSecretKey(k.toString("hex"))).toEqual(k);
    expect(() => parseSecretKey("short")).toThrow(/32 bytes/);
    const dir = mkdtempSync(join(tmpdir(), "meshterm-key-"));
    try {
      const created = loadSecretKey(null, dir);
      expect(created).toHaveLength(32);
      expect(loadSecretKey(null, dir)).toEqual(created);
      expect(readFileSync(join(dir, "secret.key"), "utf8").trim()).toBe(created.toString("base64"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
