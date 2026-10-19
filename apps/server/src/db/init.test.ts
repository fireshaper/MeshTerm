import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initDatabase } from "./init.js";
import { listConnections } from "./repositories.js";

describe("initDatabase", () => {
  it("opens, migrates and seeds on first start, and is repeatable", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "meshterm-init-"));
    try {
      const config = { dataDir, nodeHost: "192.168.1.50", nodePort: 4403 };
      const first = initDatabase(config);
      expect(first.seed).toBe("created");
      first.handle.close();

      const second = initDatabase(config);
      expect(second.seed).toBe("unchanged");
      expect(listConnections(second.handle.db)).toHaveLength(1);
      second.handle.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
