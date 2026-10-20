import type { TopologyDTO } from "@meshterm/shared";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/database.js";
import { getMyNodeNum } from "../db/repositories.js";
import { neighbors, nodes, packetStats } from "../db/schema.js";
import type { Hub } from "../events/events.js";

export const MINUTE_MS = 60_000;
/** Packet counts are kept this long. */
export const PACKET_STATS_MAX_AGE_MS = 7 * 24 * 3600_000;
const PRUNE_EVERY = 500;

/**
 * Counts every packet heard from another node (per minute, node and port) and stores
 * NeighborInfo reports (each replaces the reporter's previous list). Packets from my
 * own node aren't counted: they weren't received over the air.
 */
export function attachNetworkStats(
  hub: Hub,
  db: Db,
  options: { maxAgeMs?: number } = {},
): () => void {
  const maxAgeMs = options.maxAgeMs ?? PACKET_STATS_MAX_AGE_MS;
  const myNodes = new Map<number, number | null>();
  const myNode = (connectionId: number) => {
    if (!myNodes.has(connectionId)) myNodes.set(connectionId, getMyNodeNum(db, connectionId));
    return myNodes.get(connectionId) ?? null;
  };
  let inserts = 0;

  const offs = [
    hub.subscribe("radio.myInfo", ({ connectionId, myNodeNum }) => {
      myNodes.set(connectionId, myNodeNum);
    }),

    hub.subscribe("radio.packet", ({ connectionId, at, from, port }) => {
      if (from === myNode(connectionId) || from === 0) return;
      const minute = Math.floor(at / MINUTE_MS) * MINUTE_MS;
      db.insert(packetStats)
        .values({ connectionId, minute, nodeNum: from, port, count: 1 })
        .onConflictDoUpdate({
          target: [
            packetStats.connectionId,
            packetStats.minute,
            packetStats.nodeNum,
            packetStats.port,
          ],
          set: { count: sql`${packetStats.count} + 1` },
        })
        .run();
      if (++inserts % PRUNE_EVERY === 0) {
        db.delete(packetStats)
          .where(lt(packetStats.minute, at - maxAgeMs))
          .run();
      }
    }),

    hub.subscribe("radio.neighbors", ({ connectionId, reporter, time, neighbors: list }) => {
      db.transaction((tx) => {
        tx.delete(neighbors)
          .where(and(eq(neighbors.connectionId, connectionId), eq(neighbors.nodeNum, reporter)))
          .run();
        for (const n of list) {
          tx.insert(neighbors)
            .values({ connectionId, nodeNum: reporter, neighborNum: n.num, snr: n.snr, time })
            .onConflictDoNothing()
            .run();
        }
      });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/**
 * Nodes heard within `windowMs` and the links actually observed among them: my node's
 * direct links (a node whose last packet arrived with 0 hops; SNR as measured by my
 * node) and links from NeighborInfo reports received within the window. Nothing is
 * inferred from hop counts.
 */
export function buildTopology(
  db: Db,
  connectionId: number,
  windowMs: number,
  now: number,
): TopologyDTO {
  const since = now - windowMs;
  const myNodeNum = getMyNodeNum(db, connectionId);
  const heard = db
    .select({
      num: nodes.num,
      hopsAway: nodes.hopsAway,
      lastHeard: nodes.lastHeard,
      snr: nodes.snr,
    })
    .from(nodes)
    .where(and(eq(nodes.connectionId, connectionId), gte(nodes.lastHeard, since)))
    .all()
    .filter((n) => n.num !== myNodeNum);
  const included = new Set(heard.map((n) => n.num));
  if (myNodeNum !== null) included.add(myNodeNum);

  const links: TopologyDTO["links"] = [];
  if (myNodeNum !== null) {
    for (const n of heard) {
      if (n.hopsAway === 0 && n.lastHeard !== null) {
        links.push({ kind: "direct", from: myNodeNum, to: n.num, snr: n.snr, time: n.lastHeard });
      }
    }
  }
  const reported = db
    .select()
    .from(neighbors)
    .where(and(eq(neighbors.connectionId, connectionId), gte(neighbors.time, since)))
    .all();
  for (const r of reported) {
    // Only between nodes we show; a link to a node we haven't heard has nowhere to go.
    if (!included.has(r.nodeNum) || !included.has(r.neighborNum)) continue;
    links.push({ kind: "reported", from: r.nodeNum, to: r.neighborNum, snr: r.snr, time: r.time });
  }

  return {
    myNodeNum,
    windowMs,
    nodes: heard.map(({ num, hopsAway, lastHeard }) => ({ num, hopsAway, lastHeard })),
    links,
  };
}

/**
 * Packets heard in [from, to), summed per bucket, node and port. Bucket arithmetic runs
 * in SQL on integer literals: a bound JS number is a REAL, which would make the
 * division fractional and disable the grouping.
 */
export function packetRows(
  db: Db,
  connectionId: number,
  from: number,
  to: number,
  bucketMs: number,
): { bucket: number; nodeNum: number; port: string; count: number }[] {
  const int = (n: number) => sql.raw(String(Math.trunc(n)));
  return db
    .values<[number, number, string, number]>(
      sql`SELECT (${packetStats.minute} - ${int(from)}) / ${int(bucketMs)} AS bucket,
               ${packetStats.nodeNum}, ${packetStats.port}, SUM(${packetStats.count})
          FROM ${packetStats}
          WHERE ${packetStats.connectionId} = ${int(connectionId)}
            AND ${packetStats.minute} >= ${int(from)} AND ${packetStats.minute} < ${int(to)}
          GROUP BY bucket, ${packetStats.nodeNum}, ${packetStats.port}`,
    )
    .map(([bucket, nodeNum, port, count]) => ({ bucket, nodeNum, port, count }));
}
