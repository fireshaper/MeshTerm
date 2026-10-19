import { readFileSync } from "node:fs";
import {
  Channel,
  Config,
  create,
  fromJson,
  type JsonValue,
  Mesh,
  ModuleConfig,
  Telemetry,
} from "@meshterm/protocol";
import { z } from "zod";
import busy from "../scenarios/busy.json" with { type: "json" };
import dashboard from "../scenarios/dashboard.json" with { type: "json" };
import defaultScenario from "../scenarios/default.json" with { type: "json" };

/**
 * The mesh a FakeNode pretends to be. Loaded from JSON whose protobuf parts use
 * proto-JSON (camelCase fields, enum names as strings, bytes as base64).
 */
export interface Scenario {
  name: string;
  myInfo: Mesh.MyNodeInfo;
  metadata: Mesh.DeviceMetadata;
  /** NodeDB, including the node itself. */
  nodes: ScenarioNode[];
  channels: Channel.Channel[];
  config: Config.Config[];
  moduleConfig: ModuleConfig.ModuleConfig[];
}

export interface ScenarioNode {
  info: Mesh.NodeInfo;
  /** When set, `lastHeard` is computed as now minus this many seconds at send time. */
  lastHeardAgoS: number | null;
  /**
   * Environment readings this node broadcasts (as a TELEMETRY_APP packet) right after
   * each handshake. NodeInfo can't carry them, unlike position and device metrics.
   */
  environment: Telemetry.EnvironmentMetrics | null;
}

const ProtoJson = z.record(z.string(), z.json());

const ScenarioFile = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  myInfo: ProtoJson,
  metadata: ProtoJson,
  nodes: z.array(
    ProtoJson.and(
      z.object({
        lastHeardAgoS: z.number().int().nonnegative().optional(),
        environmentMetrics: ProtoJson.optional(),
      }),
    ),
  ),
  channels: z.array(ProtoJson),
  config: z.array(ProtoJson),
  moduleConfig: z.array(ProtoJson),
});

// Imported rather than read from disk, so loading works under Node, tsx and Vite alike.
const BUILTIN: Record<string, unknown> = { default: defaultScenario, busy, dashboard };
export const BUILTIN_SCENARIOS = ["default", "busy", "dashboard", "large"] as const;
export type BuiltinScenario = (typeof BUILTIN_SCENARIOS)[number];

/** Validates scenario JSON and turns its protobuf parts into messages. Throws on any bad field. */
export function parseScenario(json: unknown): Scenario {
  const file = ScenarioFile.parse(json);
  const scenario: Scenario = {
    name: file.name,
    myInfo: fromJson(Mesh.MyNodeInfoSchema, file.myInfo as JsonValue),
    metadata: fromJson(Mesh.DeviceMetadataSchema, file.metadata as JsonValue),
    nodes: file.nodes.map(({ lastHeardAgoS, environmentMetrics, ...info }) => ({
      info: fromJson(Mesh.NodeInfoSchema, info as JsonValue),
      lastHeardAgoS: lastHeardAgoS ?? null,
      environment: environmentMetrics
        ? fromJson(Telemetry.EnvironmentMetricsSchema, environmentMetrics as JsonValue)
        : null,
    })),
    channels: file.channels.map((c) => fromJson(Channel.ChannelSchema, c as JsonValue)),
    config: file.config.map((c) => fromJson(Config.ConfigSchema, c as JsonValue)),
    moduleConfig: file.moduleConfig.map((c) =>
      fromJson(ModuleConfig.ModuleConfigSchema, c as JsonValue),
    ),
  };
  const myNum = scenario.myInfo.myNodeNum;
  if (!scenario.nodes.some((n) => n.info.num === myNum)) {
    throw new Error(`scenario "${file.name}": no node entry for myNodeNum ${myNum}`);
  }
  return scenario;
}

/** Loads a built-in scenario by name, or any scenario file by path. */
export function loadScenario(nameOrPath: BuiltinScenario | (string & {})): Scenario {
  if (nameOrPath === "large") return largeScenario();
  const builtin = BUILTIN[nameOrPath];
  return parseScenario(builtin ?? JSON.parse(readFileSync(nameOrPath, "utf8")));
}

/** Small deterministic PRNG (mulberry32), so generated meshes are the same every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LARGE_HW = ["HELTEC_V3", "RAK4631", "T_ECHO", "TBEAM", "STATION_G2", "HELTEC_WSL_V3"];
const LARGE_ROLES = ["CLIENT", "CLIENT", "CLIENT", "ROUTER", "CLIENT_MUTE", "TRACKER", "SENSOR"];

/**
 * A generated mesh of `count` nodes (our node first) around Seattle, for performance
 * tests: about 80 % with positions, varied batteries, hops and last-heard ages up to 48 h.
 */
export function largeScenario(count = 300, seed = 42): Scenario {
  const base = loadScenario("dashboard");
  const rand = prng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const self = base.nodes.find((n) => n.info.num === base.myInfo.myNodeNum);
  if (!self) throw new Error("dashboard scenario has no self node");

  const nodes: ScenarioNode[] = [self];
  for (let i = 1; i < count; i++) {
    const num = 0x2000_0000 + i;
    const label = String(i).padStart(3, "0");
    const hasPosition = rand() < 0.8;
    nodes.push({
      info: create(Mesh.NodeInfoSchema, {
        num,
        user: {
          id: `!${num.toString(16).padStart(8, "0")}`,
          longName: `Node ${label}`,
          shortName: `N${label}`,
          hwModel: Mesh.HardwareModel[pick(LARGE_HW) as keyof typeof Mesh.HardwareModel],
          role: Config.Config_DeviceConfig_Role[
            pick(LARGE_ROLES) as keyof typeof Config.Config_DeviceConfig_Role
          ],
        },
        ...(hasPosition
          ? {
              position: {
                latitudeI: Math.round((47.3 + rand() * 0.6) * 1e7),
                longitudeI: Math.round((-122.6 + rand() * 0.7) * 1e7),
                altitude: Math.round(rand() * 600),
              },
            }
          : {}),
        deviceMetrics: {
          batteryLevel: rand() < 0.15 ? 101 : Math.round(5 + rand() * 95),
          voltage: Math.round((3.3 + rand() * 0.9) * 100) / 100,
        },
        snr: Math.round((-15 + rand() * 25) * 4) / 4,
        hopsAway: Math.floor(rand() * 5),
        isFavorite: rand() < 0.05,
      }),
      lastHeardAgoS: Math.floor(rand() * 48 * 3600),
      environment: null,
    });
  }
  return { ...base, name: "large", nodes };
}
