import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "protocol",
    include: ["src/**/*.test.ts"],
  },
});
