import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import type { NodeConnection } from "../connection/node-connection.js";
import { openTestDatabase } from "../db/test-db.js";
import { setMyNodeNum, upsertNode } from "../db/repositories.js";
import { Hub } from "../events/events.js";
import { fixtures } from "@meshterm/shared";
import { RESPONSE_TIMEOUT_MS, TelemetryRequester } from "./telemetry-request.js";

describe("TelemetryRequester", () => {
  it("reports a timeout when no answer comes, and ignores answers of another kind", () => {
    const handle = openTestDatabase();
    const hub = new Hub();
    const clock = new FakeClock();
    const sent: unknown[] = [];
    const conn = {
      state: "connected",
      send: (m: unknown) => sent.push(m),
    } as unknown as NodeConnection;
    setMyNodeNum(handle.db, 1, 1);
    upsertNode(handle.db, { ...fixtures.node, connectionId: 1, num: 2, hopsAway: 1 });
    const states: string[] = [];
    hub.subscribe("telemetry.request", (p) => states.push(p.state));
    const r = new TelemetryRequester({
      db: handle.db,
      hub,
      connections: new Map([[1, conn]]),
      clock,
      random: () => 0.5,
    });
    r.request(1, 2, "device");
    hub.publish("telemetry.new", {
      telemetry: { connectionId: 1, nodeNum: 2, time: 0, kind: "power", metrics: {} },
    });
    clock.advance(RESPONSE_TIMEOUT_MS);
    expect(states).toEqual(["sent", "timeout"]);
    expect(sent).toHaveLength(1);
    r.close();
    handle.close();
  });
});
