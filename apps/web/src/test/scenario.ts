// FakeNode scenarios as the shared domain types the server would send, for component tests.
import { loadScenario } from "@meshterm/fake-node";
import { Channel as ChannelPb, Config, Mesh } from "@meshterm/protocol";
import { nodeIdFromNum, type Channel, type MeshNode } from "@meshterm/shared";

const enumName = (e: object, v: number): string | null => {
  const name: unknown = (e as Record<number, unknown>)[v];
  return typeof name === "string" ? name : null;
};

export function scenarioChannels(name = "default", connectionId = 1): Channel[] {
  return loadScenario(name).channels.map((c) => ({
    connectionId,
    index: c.index,
    name: c.settings?.name ?? "",
    role: (enumName(ChannelPb.Channel_Role, c.role) ?? "DISABLED") as Channel["role"],
  }));
}

/** Nodes with `lastHeard` resolved against `nowMs` (epoch ms). */
export function scenarioNodes(name = "default", nowMs = Date.now(), connectionId = 1): MeshNode[] {
  return loadScenario(name).nodes.map(({ info, lastHeardAgoS }) => ({
    connectionId,
    num: info.num,
    id: nodeIdFromNum(info.num),
    longName: info.user?.longName ?? "",
    shortName: info.user?.shortName ?? "",
    hwModel: info.user ? enumName(Mesh.HardwareModel, info.user.hwModel) : null,
    role: info.user ? enumName(Config.Config_DeviceConfig_Role, info.user.role) : null,
    lastHeard: lastHeardAgoS === null ? null : nowMs - lastHeardAgoS * 1000,
    snr: info.lastHeard > 0 || lastHeardAgoS !== null ? info.snr : null,
    hopsAway: info.hopsAway ?? null,
    isFavorite: info.isFavorite,
  }));
}

export const SCENARIO_MY_NODE = 0xa1b2c3d4;
