import { largeScenario } from "@meshterm/fake-node";
import { Config, Mesh } from "@meshterm/protocol";
import type { DashboardDTO } from "@meshterm/shared";
import { describe, expect, it } from "vitest";
import { nodes, telemetry } from "../db/schema.js";
import { startTestApp } from "../test-app.js";

const enumName = (e: object, v: number) => (e as Record<number, string | undefined>)[v] ?? null;

describe("dashboard performance", () => {
  it("answers in under 50 ms (median) for 300 nodes with 24 h of telemetry", async () => {
    const t = await startTestApp();
    try {
      const db = t.app.meshterm.db;
      const now = Date.now();
      const scenario = largeScenario(300);

      const nodeRows = scenario.nodes.map(({ info, lastHeardAgoS }) => ({
        connectionId: 1,
        num: info.num,
        longName: info.user?.longName ?? "",
        shortName: info.user?.shortName ?? "",
        hwModel: info.user ? enumName(Mesh.HardwareModel, info.user.hwModel) : null,
        role: info.user ? enumName(Config.Config_DeviceConfig_Role, info.user.role) : null,
        lastHeard: now - (lastHeardAgoS ?? 0) * 1000,
        snr: info.snr,
        hopsAway: info.hopsAway ?? null,
        isFavorite: info.isFavorite,
        lat: info.position ? (info.position.latitudeI ?? 0) / 1e7 : null,
        lon: info.position ? (info.position.longitudeI ?? 0) / 1e7 : null,
        altitude: info.position?.altitude ?? null,
        positionTime: info.position ? now : null,
        batteryLevel: info.deviceMetrics?.batteryLevel ?? null,
        voltage: info.deviceMetrics?.voltage ?? null,
        deviceTime: now,
      }));
      // 48 device reports per node over the last 24 h: 14,400 rows.
      const telemetryRows = scenario.nodes.flatMap(({ info }) =>
        Array.from({ length: 48 }, (_, i) => ({
          connectionId: 1,
          nodeNum: info.num,
          kind: "device" as const,
          time: now - i * 30 * 60_000 - 1_000,
          batteryLevel: 40 + (i % 50),
          voltage: 3.9,
        })),
      );
      db.transaction((tx) => {
        for (let i = 0; i < nodeRows.length; i += 200) {
          tx.insert(nodes)
            .values(nodeRows.slice(i, i + 200))
            .onConflictDoNothing()
            .run();
        }
        for (let i = 0; i < telemetryRows.length; i += 500) {
          tx.insert(telemetry)
            .values(telemetryRows.slice(i, i + 500))
            .run();
        }
      });

      const call = async () => {
        const start = performance.now();
        const res = await t.app.inject({ method: "GET", url: "/api/connections/1/dashboard" });
        const ms = performance.now() - start;
        expect(res.statusCode).toBe(200);
        return { ms, dto: res.json<DashboardDTO>() };
      };
      const first = await call(); // warm-up
      expect(first.dto.nodes.length).toBeGreaterThanOrEqual(300);
      expect(first.dto.nodes.some((n) => n.batterySpark.length >= 47)).toBe(true);

      const times: number[] = [];
      for (let i = 0; i < 20; i++) times.push((await call()).ms);
      times.sort((a, b) => a - b);
      const median = times[10] ?? Infinity;
      console.log(
        `dashboard median ${median.toFixed(1)} ms (min ${times[0]?.toFixed(1)}, max ${times.at(-1)?.toFixed(1)})`,
      );
      expect(median).toBeLessThan(50);
    } finally {
      await t.close();
    }
  }, 30_000);
});
