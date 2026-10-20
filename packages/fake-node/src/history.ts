import type { TelemetryInit } from "./fake-node.js";

/** One backdated telemetry packet, as a node would have sent it in the past. */
export interface HistoryPacket {
  from: number;
  telemetry: TelemetryInit;
  /** When it was heard (epoch ms); also the report's own time. */
  at: number;
  hopsAway: number;
  rxSnr: number;
  rxRssi: number;
}

/** Nodes of the `dashboard` scenario the history fixture reports for (CR-001 §8). */
export const HISTORY_NODES = {
  /** Battery node every 15 min for 30 d, a 6 h gap 3 days ago, a reboot 5 days ago. */
  garden: 0x5e6f7081,
  /** External power (battery 101), heard directly: also the signal history. */
  ridge: 0x0badcafe,
  /** Environment sensor every 30 min. */
  trail: 0x1a2b3c4d,
  /** INA power monitor every 30 min. */
  hill: 0x22334455,
  /** Never sends telemetry. */
  bike: 0x55667788,
} as const;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Deterministic noise in [-1, 1). */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x8000_0000 - 1;
  };
}

/**
 * A stand-in for sunlight: 0 a whole number of days before `now`, 1 half a day off.
 * Relative to `now`, so the curves look the same whenever the fixture is generated.
 */
const daylight = (t: number) => (1 - Math.cos(((t % DAY) / DAY) * 2 * Math.PI)) / 2;
const round = (x: number, places = 2) => Number(x.toFixed(places));

/**
 * 30 days of telemetry for the `dashboard` scenario, ending at `now`, oldest first.
 * The same shape for any `now` (rounded to the minute), so screenshots are stable.
 */
export function historyPackets(nowMs: number, days = 30): HistoryPacket[] {
  const now = Math.floor(nowMs / MIN) * MIN;
  const start = now - days * DAY;
  const out: HistoryPacket[] = [];
  const n = noise(42);

  // Garden: solar battery, gap, reboot.
  const gapFrom = now - 3 * DAY;
  const gapTo = gapFrom + 6 * HOUR;
  const rebootAt = now - 5 * DAY;
  for (let t = start; t < now; t += 15 * MIN) {
    if (t >= gapFrom && t < gapTo) continue;
    const sun = daylight(t - now);
    const uptimeStart = t >= rebootAt ? rebootAt : start - 2 * DAY;
    out.push({
      from: HISTORY_NODES.garden,
      at: t,
      hopsAway: 2,
      rxSnr: round(-4 + n() * 3),
      rxRssi: Math.round(-108 + n() * 6),
      telemetry: {
        time: Math.floor(t / 1000),
        variant: {
          case: "deviceMetrics",
          value: {
            batteryLevel: Math.round(62 + 30 * sun + n() * 2),
            voltage: round(3.6 + 0.5 * sun + n() * 0.02, 3),
            channelUtilization: round(8 + 6 * sun + n() * 2),
            airUtilTx: round(1 + sun + n() * 0.3),
            uptimeSeconds: Math.floor((t - uptimeStart) / 1000),
          },
        },
      },
    });
  }

  // Ridge: external power, heard directly (the signal history).
  for (let t = start; t < now; t += 15 * MIN) {
    out.push({
      from: HISTORY_NODES.ridge,
      at: t,
      hopsAway: 0,
      rxSnr: round(7 + 2 * Math.sin((t - now) / (6 * HOUR)) + n()),
      rxRssi: Math.round(-80 + 4 * Math.sin((t - now) / (6 * HOUR)) + n() * 2),
      telemetry: {
        time: Math.floor(t / 1000),
        variant: {
          case: "deviceMetrics",
          value: {
            batteryLevel: 101,
            voltage: round(5.1 + n() * 0.02, 3),
            channelUtilization: round(14 + 8 * daylight(t - now) + n() * 2),
            airUtilTx: round(2.5 + daylight(t - now) + n() * 0.3),
            uptimeSeconds: Math.floor((t - (start - 10 * DAY)) / 1000),
          },
        },
      },
    });
  }

  // Trail: environment sensor.
  for (let t = start; t < now; t += 30 * MIN) {
    const sun = daylight(t - now);
    out.push({
      from: HISTORY_NODES.trail,
      at: t,
      hopsAway: 1,
      rxSnr: round(2 + n() * 2),
      rxRssi: Math.round(-95 + n() * 4),
      telemetry: {
        time: Math.floor(t / 1000),
        variant: {
          case: "environmentMetrics",
          value: {
            temperature: round(8 + 14 * sun + n()),
            relativeHumidity: round(85 - 40 * sun + n() * 3),
            barometricPressure: round(1012 + 6 * Math.sin((t - now) / (3 * DAY)) + n() * 0.5),
            gasResistance: round(80 + 20 * Math.sin((t - now) / DAY) + n() * 2),
            lux: round(Math.max(0, 900 * sun - 150 + n() * 20)),
          },
        },
      },
    });
  }

  // Hill: INA power monitor (solar panel on ch1, load on ch2).
  for (let t = start; t < now; t += 30 * MIN) {
    const sun = daylight(t - now);
    out.push({
      from: HISTORY_NODES.hill,
      at: t,
      hopsAway: 0,
      rxSnr: round(4 + n() * 2),
      rxRssi: Math.round(-90 + n() * 4),
      telemetry: {
        time: Math.floor(t / 1000),
        variant: {
          case: "powerMetrics",
          value: {
            ch1Voltage: round(12.2 + 1.6 * sun + n() * 0.05, 3),
            ch1Current: round(40 + 360 * sun + n() * 10),
            ch2Voltage: round(5 + n() * 0.02, 3),
            ch2Current: round(70 + n() * 10),
          },
        },
      },
    });
  }

  return out.sort((a, b) => a.at - b.at || a.from - b.from);
}
