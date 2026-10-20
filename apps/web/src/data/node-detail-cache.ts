import type { MeshNode, NodeDetailDTO, NodePosition, TelemetryReport } from "@meshterm/shared";

/** `node.upsert`: identity, favorite and last-heard fields of the open node. */
export function applyNodeToDetail(d: NodeDetailDTO, node: MeshNode): NodeDetailDTO {
  if (node.num !== d.num) return d;
  const next: NodeDetailDTO = {
    ...d,
    longName: node.longName,
    shortName: node.shortName,
    role: node.role,
    hwModel: node.hwModel,
    isFavorite: node.isFavorite,
    isIgnored: node.isIgnored,
    lastHeard: node.lastHeard,
    hopsAway: node.hopsAway,
    snr: node.snr,
  };
  const same = (Object.keys(next) as (keyof NodeDetailDTO)[]).every((k) => next[k] === d[k]);
  return same ? d : next;
}

/** Non-null fields of `update` over `base` (a report only carries what it measured). */
function merge<T extends object>(base: T | null, update: T): T {
  if (!base) return update;
  const out = { ...base };
  for (const [k, v] of Object.entries(update)) {
    if (v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** `telemetry.new`: the newest report of its kind, and the card's latest values. */
export function applyTelemetryToDetail(d: NodeDetailDTO, r: TelemetryReport): NodeDetailDTO {
  if (r.nodeNum !== d.num) return d;
  const current = d.latestTelemetry[r.kind];
  if (current && current.time > r.time) return d;
  const metrics = r.metrics ?? current?.metrics ?? {};
  const next: NodeDetailDTO = {
    ...d,
    latestTelemetry: { ...d.latestTelemetry, [r.kind]: { time: r.time, metrics } },
    telemetryKinds: d.telemetryKinds.includes(r.kind)
      ? d.telemetryKinds
      : [...d.telemetryKinds, r.kind],
  };
  if (r.kind === "device") next.device = merge(d.device, { ...r.device, time: r.time });
  if (r.kind === "environment") {
    next.environment = merge(d.environment, { ...r.environment, time: r.time });
  }
  return next;
}

/** `position.new`: a newer position of the open node. */
export function applyPositionToDetail(d: NodeDetailDTO, p: NodePosition): NodeDetailDTO {
  if (p.nodeNum !== d.num || (d.position && d.position.time > p.time)) return d;
  return {
    ...d,
    position: {
      lat: p.lat,
      lon: p.lon,
      alt: p.altitude,
      precisionBits: p.precisionBits,
      time: p.time,
    },
  };
}
