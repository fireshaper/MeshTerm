import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Timing tests are their own project, run last (apps/server/vitest.perf.config.ts).
    projects: ["apps/*", "packages/*", "apps/server/vitest.perf.config.ts"],
  },
});
