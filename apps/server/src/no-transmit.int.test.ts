import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditInbound, FakeNode } from "@meshterm/fake-node";
import { describe, expect, it } from "vitest";
import { openDataDirDatabase } from "./db/database.js";
import { startTestApp } from "./test-app.js";

const HEARTBEAT_MS = 100;
const idle = () => new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 5 + 50));

describe("no-transmit guarantee", () => {
  it("idle app + one restart sends only handshakes and heartbeats", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "meshterm-notx-"));
    const node = new FakeNode();
    await node.start();
    const env = { MESHTERM_HEARTBEAT_INTERVAL_MS: String(HEARTBEAT_MS) };
    try {
      for (let run = 0; run < 2; run++) {
        const t = await startTestApp({
          node,
          env,
          deps: { database: openDataDirDatabase(dataDir) },
        });
        await idle();
        await t.app.close();
      }

      const audit = auditInbound(node.inbound);
      expect(audit.counts.transmit).toBe(0);
      expect(audit.counts.other).toBe(0);
      expect(audit.counts.handshake).toBe(2);
      // About five per run; allow for timer jitter.
      expect(audit.counts.heartbeat).toBeGreaterThanOrEqual(6);
    } finally {
      await node.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
