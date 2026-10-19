import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT as PORT } from "./ports.js";

/**
 * End-to-end tests against the built SPA served by the real server (see serve.ts).
 * Run with `pnpm --filter @meshterm/web test:e2e`, which builds first.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results",
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  // One shared FakeNode (reboots, ack modes, injected messages), so one test at a time.
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: "light",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: {
    command: "pnpm exec tsx e2e/serve.ts",
    cwd: "..",
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
