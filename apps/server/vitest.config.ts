import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "server",
    include: ["src/**/*.test.ts"],
    // Timing tests run on their own afterwards (vitest.perf.config.ts).
    exclude: ["src/**/*-perf.int.test.ts"],
  },
});
