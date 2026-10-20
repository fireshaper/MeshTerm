import { defineProject } from "vitest/config";

/**
 * Timing tests (`*-perf.int.test.ts`): run after every other project and one file at a
 * time, so other tests' CPU use can't push them over their budgets.
 */
export default defineProject({
  test: {
    name: "server-perf",
    include: ["src/**/*-perf.int.test.ts"],
    fileParallelism: false,
    sequence: { groupOrder: 1 },
  },
});
