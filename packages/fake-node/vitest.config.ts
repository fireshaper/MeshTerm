import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "fake-node",
    include: ["src/**/*.test.ts"],
  },
});
