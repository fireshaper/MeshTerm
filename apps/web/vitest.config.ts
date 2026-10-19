import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
