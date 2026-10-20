// FakeNode scenarios as the shared domain types the server would send, for component tests.
import { loadScenario } from "@meshterm/fake-node";
import { Channel as ChannelPb, Config, Mesh } from "@meshterm/protocol";
import {
  DEFAULT_DASHBOARD_THRESHOLDS,
  nodeIdFromNum,
  pskKind,
  type Channel,
  type DashboardDTO,
  type MeshNode,
  type NodeCard,
} from "@meshterm/shared";

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
    encryption: pskKind(c.settings?.psk),
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
    hasPublicKey: (info.user?.publicKey.length ?? 0) === 32,
    isIgnored: info.isIgnored,
  }));
}

export const SCENARIO_MY_NODE = 0xa1b2c3d4;

const round = (x: number | undefined, places: number) =>
  x === undefined ? null : Number(x.toFixed(places));

/**
 * A scenario as `GET /dashboard` would return it right after the handshake (no
 * sparks, no messages): the cards the server builds from NodeInfo.
 */
export function scenarioDashboard(name = "dashboard", nowMs = Date.now()): DashboardDTO {
  const scenario = loadScenario(name);
  const myNodeNum = scenario.myInfo.myNodeNum;
  const base = scenarioNodes(name, nowMs);
  const nodes: NodeCard[] = scenario.nodes.map(({ info, environment }, i) => {
    const node = base[i] as MeshNode;
    const heardAt = node.lastHeard ?? nowMs;
    const p = info.position;
    const hasFix = p?.latitudeI !== undefined && p.longitudeI !== undefined;
    const d = info.deviceMetrics;
    return {
      num: node.num,
      userId: node.id,
      longName: node.longName,
      shortName: node.shortName,
      role: node.role,
      hwModel: node.hwModel,
      isFavorite: node.isFavorite,
      isSelf: node.num === myNodeNum,
      lastHeard: node.lastHeard,
      hopsAway: node.hopsAway,
      snr: node.num === myNodeNum ? null : node.snr,
      rssi: null,
      position:
        p && hasFix
          ? {
              lat: (p.latitudeI ?? 0) / 1e7,
              lon: (p.longitudeI ?? 0) / 1e7,
              alt: p.altitude ?? null,
              precisionBits: p.precisionBits || null,
              time: heardAt,
            }
          : null,
      device: d
        ? {
            batteryLevel: d.batteryLevel ?? null,
            voltage: round(d.voltage, 3),
            channelUtil: round(d.channelUtilization, 2),
            airUtilTx: round(d.airUtilTx, 2),
            uptimeSeconds: d.uptimeSeconds ?? null,
            time: heardAt,
          }
        : null,
      environment: environment
        ? {
            temperature: round(environment.temperature, 2),
            humidity: round(environment.relativeHumidity, 2),
            pressure: round(environment.barometricPressure, 2),
            time: heardAt,
          }
        : null,
      batterySpark: [],
    };
  });
  const self = nodes.find((n) => n.isSelf) ?? null;
  return {
    summary: {
      connectionId: 1,
      connectionState: "connected",
      connectedSince: nowMs - 3600_000,
      nodesTotal: nodes.length,
      nodesOnline: nodes.filter((n) => n.lastHeard !== null && nowMs - n.lastHeard < 15 * 60_000)
        .length,
      myNodeNum,
      myBattery: self?.device?.batteryLevel ?? null,
      channelUtil: self?.device?.channelUtil ?? null,
      airUtilTx: self?.device?.airUtilTx ?? null,
      messages24h: 0,
      messagesIn24h: 0,
      messagesOut24h: 0,
      lastPacketAt: nowMs - 4000,
      channelUtilSpark: [],
      airUtilTxSpark: [],
    },
    thresholds: DEFAULT_DASHBOARD_THRESHOLDS,
    nodes,
  };
}
