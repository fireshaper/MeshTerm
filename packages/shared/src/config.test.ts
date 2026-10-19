import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config.js";

const HOST = { MESHTERM_NODE_HOST: "192.168.1.50" };

function issuesFor(env: Record<string, string | undefined>): string[] {
  try {
    parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.issues.map((i) => i.field);
    throw err;
  }
  throw new Error("expected parseConfig to throw");
}

describe("parseConfig", () => {
  it("rejects a tile URL without {z}/{x}/{y}", () => {
    expect(issuesFor({ ...HOST, MESHTERM_TILE_URL: "https://tiles.example/x.png" })).toEqual([
      "MESHTERM_TILE_URL",
    ]);
  });

  it("applies defaults when only the host is given", () => {
    expect(parseConfig(HOST)).toEqual({
      nodeHost: "192.168.1.50",
      nodePort: 4403,
      httpPort: 8080,
      dataDir: "/data",
      webDir: null,
      themesDir: null,
      logLevel: "info",
      connectTimeoutMs: 10_000,
      tcpKeepAliveMs: 15_000,
      configTimeoutMs: 30_000,
      heartbeatIntervalMs: 60_000,
      ackTimeoutMs: 120_000,
      backoffMinMs: 2_000,
      backoffMaxMs: 60_000,
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      tileCacheMb: 500,
    });
  });

  it("parses explicit values from strings", () => {
    const config = parseConfig({
      ...HOST,
      MESHTERM_NODE_PORT: "4500",
      MESHTERM_HTTP_PORT: "3000",
      MESHTERM_DATA_DIR: "./data",
      MESHTERM_LOG_LEVEL: "debug",
      MESHTERM_BACKOFF_MIN_MS: "100",
      MESHTERM_BACKOFF_MAX_MS: "1000",
    });
    expect(config).toMatchObject({
      nodePort: 4500,
      httpPort: 3000,
      dataDir: "./data",
      logLevel: "debug",
      backoffMinMs: 100,
      backoffMaxMs: 1000,
    });
  });

  it("ignores unrelated environment variables", () => {
    expect(parseConfig({ ...HOST, PATH: "/usr/bin" }).nodeHost).toBe("192.168.1.50");
  });

  it("requires the node host", () => {
    expect(issuesFor({})).toEqual(["MESHTERM_NODE_HOST"]);
    expect(issuesFor({ MESHTERM_NODE_HOST: "  " })).toEqual(["MESHTERM_NODE_HOST"]);
  });

  it.each(["0", "70000", "abc", "44.5", ""])("rejects node port %j", (value) => {
    expect(issuesFor({ ...HOST, MESHTERM_NODE_PORT: value })).toEqual(["MESHTERM_NODE_PORT"]);
  });

  it("rejects an unknown log level", () => {
    expect(issuesFor({ ...HOST, MESHTERM_LOG_LEVEL: "loud" })).toEqual(["MESHTERM_LOG_LEVEL"]);
  });

  it("rejects a backoff maximum below the minimum", () => {
    expect(
      issuesFor({ ...HOST, MESHTERM_BACKOFF_MIN_MS: "5000", MESHTERM_BACKOFF_MAX_MS: "1000" }),
    ).toEqual(["MESHTERM_BACKOFF_MAX_MS"]);
  });

  it("names every bad field in the error message", () => {
    const env = { MESHTERM_NODE_PORT: "0", MESHTERM_HTTP_PORT: "nope", MESHTERM_LOG_LEVEL: "x" };
    expect(() => parseConfig(env)).toThrow(ConfigError);
    try {
      parseConfig(env);
    } catch (err) {
      const message = (err as Error).message;
      for (const field of [
        "MESHTERM_NODE_HOST",
        "MESHTERM_NODE_PORT",
        "MESHTERM_HTTP_PORT",
        "MESHTERM_LOG_LEVEL",
      ]) {
        expect(message).toContain(field);
      }
    }
  });
});
