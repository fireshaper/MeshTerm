import type { NodePosition, TelemetryReport } from "@meshterm/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./database.js";
import { connections, nodes, positions, telemetry } from "./schema.js";

/** Makes sure a row exists for a node we only know by number (all other fields default). */
export function ensureNode(db: Db, connectionId: number, num: number): void {
  db.insert(nodes).values({ connectionId, num }).onConflictDoNothing().run();
}

const isNode = (connectionId: number, num: number) =>
  and(eq(nodes.connectionId, connectionId), eq(nodes.num, num));

/**
 * Stores one telemetry report: a history row (a repeat of the same node/kind/time,
 * e.g. from a later handshake, is ignored) and the node's latest values, unless it
 * already has newer ones. Fields the report leaves out keep their stored value.
 * Returns whether this was new history.
 */
export function recordTelemetry(db: Db, report: TelemetryReport): boolean {
  const { connectionId, nodeNum, time } = report;
  return db.transaction((tx) => {
    ensureNode(tx, connectionId, nodeNum);
    if (report.kind === "device") {
      const d = report.device;
      const { changes } = tx
        .insert(telemetry)
        .values({ connectionId, nodeNum, kind: "device", time, ...d, metrics: report.metrics })
        .onConflictDoNothing()
        .run();
      tx.update(nodes)
        .set({
          batteryLevel: sql`coalesce(${d.batteryLevel}, ${nodes.batteryLevel})`,
          voltage: sql`coalesce(${d.voltage}, ${nodes.voltage})`,
          channelUtil: sql`coalesce(${d.channelUtil}, ${nodes.channelUtil})`,
          airUtilTx: sql`coalesce(${d.airUtilTx}, ${nodes.airUtilTx})`,
          uptimeSeconds: sql`coalesce(${d.uptimeSeconds}, ${nodes.uptimeSeconds})`,
          deviceTime: time,
        })
        .where(
          and(
            isNode(connectionId, nodeNum),
            sql`(${nodes.deviceTime} IS NULL OR ${nodes.deviceTime} <= ${time})`,
          ),
        )
        .run();
      return changes > 0;
    }
    if (report.kind === "power" || report.kind === "air_quality") {
      const { changes } = tx
        .insert(telemetry)
        .values({ connectionId, nodeNum, kind: report.kind, time, metrics: report.metrics })
        .onConflictDoNothing()
        .run();
      return changes > 0;
    }
    const e = report.environment;
    const { changes } = tx
      .insert(telemetry)
      .values({ connectionId, nodeNum, kind: "environment", time, ...e, metrics: report.metrics })
      .onConflictDoNothing()
      .run();
    tx.update(nodes)
      .set({
        temperature: sql`coalesce(${e.temperature}, ${nodes.temperature})`,
        humidity: sql`coalesce(${e.humidity}, ${nodes.humidity})`,
        pressure: sql`coalesce(${e.pressure}, ${nodes.pressure})`,
        envTime: time,
      })
      .where(
        and(
          isNode(connectionId, nodeNum),
          sql`(${nodes.envTime} IS NULL OR ${nodes.envTime} <= ${time})`,
        ),
      )
      .run();
    return changes > 0;
  });
}

/** Stores a position: history (repeats ignored) and the node's latest, unless it has a newer one. */
export function recordPosition(db: Db, position: NodePosition, rxTime: number): boolean {
  const { connectionId, nodeNum, lat, lon, altitude, precisionBits, time } = position;
  return db.transaction((tx) => {
    ensureNode(tx, connectionId, nodeNum);
    const { changes } = tx
      .insert(positions)
      .values({ connectionId, nodeNum, lat, lon, altitude, precisionBits, time, rxTime })
      .onConflictDoNothing()
      .run();
    tx.update(nodes)
      .set({ lat, lon, altitude, precisionBits, positionTime: time })
      .where(
        and(
          isNode(connectionId, nodeNum),
          sql`(${nodes.positionTime} IS NULL OR ${nodes.positionTime} <= ${time})`,
        ),
      )
      .run();
    return changes > 0;
  });
}

export function setNodeRssi(db: Db, connectionId: number, num: number, rssi: number | null): void {
  db.update(nodes).set({ rssi }).where(isNode(connectionId, num)).run();
}

/** Records that a packet arrived (never moves backwards). */
export function setLastPacketAt(db: Db, connectionId: number, at: number): void {
  db.update(connections)
    .set({ lastPacketAt: at })
    .where(
      and(
        eq(connections.id, connectionId),
        sql`(${connections.lastPacketAt} IS NULL OR ${connections.lastPacketAt} < ${at})`,
      ),
    )
    .run();
}
