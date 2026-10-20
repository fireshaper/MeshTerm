import { describe, expect, it } from "vitest";
import { HISTORY_NODES, historyPackets } from "./history.js";
import { loadScenario } from "./scenario.js";

const NOW = 1_800_000_000_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe("historyPackets", () => {
  const packets = historyPackets(NOW);
  const of = (num: number) => packets.filter((p) => p.from === num);

  it("covers the dashboard scenario's nodes, oldest first, and is deterministic", () => {
    const nums = new Set(loadScenario("dashboard").nodes.map((n) => n.info.num));
    for (const num of Object.values(HISTORY_NODES)) expect(nums.has(num)).toBe(true);
    expect(packets.every((p, i) => i === 0 || (packets[i - 1]?.at ?? 0) <= p.at)).toBe(true);
    expect(historyPackets(NOW)).toEqual(packets);
    expect(of(HISTORY_NODES.bike)).toEqual([]);
  });

  it("garden: every 15 min for 30 d except a 6 h gap, with one reboot", () => {
    const garden = of(HISTORY_NODES.garden);
    expect(garden.length).toBe(30 * 96 - 24);
    const gaps = garden.slice(1).map((p, i) => p.at - (garden[i]?.at ?? p.at));
    expect(Math.max(...gaps)).toBe(6 * HOUR + 15 * 60_000);
    const uptimes = garden.map((p) =>
      p.telemetry.variant?.case === "deviceMetrics"
        ? (p.telemetry.variant.value.uptimeSeconds ?? 0)
        : 0,
    );
    expect(uptimes.filter((u, i) => i > 0 && u < (uptimes[i - 1] ?? 0))).toHaveLength(1);
  });

  it("ridge is on external power; hill reports power metrics; trail environment", () => {
    const ridge = of(HISTORY_NODES.ridge)[0]?.telemetry.variant;
    expect(ridge?.case === "deviceMetrics" && ridge.value.batteryLevel).toBe(101);
    expect(of(HISTORY_NODES.hill)[0]?.telemetry.variant?.case).toBe("powerMetrics");
    expect(of(HISTORY_NODES.trail)[0]?.telemetry.variant?.case).toBe("environmentMetrics");
    expect(of(HISTORY_NODES.trail)).toHaveLength(30 * 48);
    expect(packets[0]?.at).toBe(NOW - 30 * DAY);
  });
});
