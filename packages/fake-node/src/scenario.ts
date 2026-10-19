import { readFileSync } from "node:fs";
import { Channel, Config, fromJson, type JsonValue, Mesh, ModuleConfig } from "@meshterm/protocol";
import { z } from "zod";
import busy from "../scenarios/busy.json" with { type: "json" };
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
}

const ProtoJson = z.record(z.string(), z.json());

const ScenarioFile = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  myInfo: ProtoJson,
  metadata: ProtoJson,
  nodes: z.array(
    ProtoJson.and(z.object({ lastHeardAgoS: z.number().int().nonnegative().optional() })),
  ),
  channels: z.array(ProtoJson),
  config: z.array(ProtoJson),
  moduleConfig: z.array(ProtoJson),
});

// Imported rather than read from disk, so loading works under Node, tsx and Vite alike.
const BUILTIN: Record<string, unknown> = { default: defaultScenario, busy };
export const BUILTIN_SCENARIOS = ["default", "busy"] as const;
export type BuiltinScenario = (typeof BUILTIN_SCENARIOS)[number];

/** Validates scenario JSON and turns its protobuf parts into messages. Throws on any bad field. */
export function parseScenario(json: unknown): Scenario {
  const file = ScenarioFile.parse(json);
  const scenario: Scenario = {
    name: file.name,
    myInfo: fromJson(Mesh.MyNodeInfoSchema, file.myInfo as JsonValue),
    metadata: fromJson(Mesh.DeviceMetadataSchema, file.metadata as JsonValue),
    nodes: file.nodes.map(({ lastHeardAgoS, ...info }) => ({
      info: fromJson(Mesh.NodeInfoSchema, info as JsonValue),
      lastHeardAgoS: lastHeardAgoS ?? null,
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
  const builtin = BUILTIN[nameOrPath];
  return parseScenario(builtin ?? JSON.parse(readFileSync(nameOrPath, "utf8")));
}
