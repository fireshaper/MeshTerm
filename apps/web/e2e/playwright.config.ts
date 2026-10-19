import { defineConfig, devices } from "@playwright/test";
import { CONTROL_PORT, E2E_PORT, VISUAL_CONTROL_PORT, VISUAL_PORT } from "./ports.js";

const DESKTOP = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } };
const MOBILE = {
  ...devices["Desktop Chrome"],
  viewport: { width: 390, height: 844 },
  hasTouch: true,
};
const SPECIAL = ["**/gate.spec.ts", "**/visual.spec.ts"];

/**
 * End-to-end tests against the built SPA served by the real server.
 * `pnpm --filter @meshterm/web test:e2e` builds first; `test:gate` repeats the gate 3×.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results",
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  // Specs share FakeNodes (reboots, ack modes, injected messages), so one test at a time.
  fullyParallel: false,
  workers: 1,
  use: { colorScheme: "light" },
  expect: {
    // Antialiasing differs slightly between runs; layout or color changes exceed this.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  projects: [
    {
      name: "desktop",
      testIgnore: SPECIAL,
      use: { ...DESKTOP, baseURL: `http://127.0.0.1:${E2E_PORT}` },
    },
    {
      name: "mobile",
      testIgnore: SPECIAL,
      use: { ...MOBILE, baseURL: `http://127.0.0.1:${E2E_PORT}` },
    },
    // Starts its own FakeNode and server processes (it restarts the server).
    { name: "gate", testMatch: "**/gate.spec.ts", use: DESKTOP },
    {
      name: "visual-desktop",
      testMatch: "**/visual.spec.ts",
      use: { ...DESKTOP, baseURL: `http://127.0.0.1:${VISUAL_PORT}` },
    },
    {
      name: "visual-mobile",
      testMatch: "**/visual.spec.ts",
      use: { ...MOBILE, baseURL: `http://127.0.0.1:${VISUAL_PORT}` },
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx e2e/serve.ts",
      cwd: "..",
      env: { E2E_PORT: String(E2E_PORT), E2E_CONTROL_PORT: String(CONTROL_PORT) },
      url: `http://127.0.0.1:${E2E_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // A separate instance for visual baselines, untouched by other specs.
      command: "pnpm exec tsx e2e/serve.ts",
      cwd: "..",
      env: { E2E_PORT: String(VISUAL_PORT), E2E_CONTROL_PORT: String(VISUAL_CONTROL_PORT) },
      url: `http://127.0.0.1:${VISUAL_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
