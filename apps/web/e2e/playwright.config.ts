import { defineConfig, devices } from "@playwright/test";
import {
  CONTROL_PORT,
  DASHBOARD_CONTROL_PORT,
  DASHBOARD_PORT,
  AUTH_CONTROL_PORT,
  AUTH_PORT,
  E2E_PORT,
  HISTORY_CONTROL_PORT,
  HISTORY_PORT,
  LARGE_CONTROL_PORT,
  LARGE_PORT,
  VISUAL_CONTROL_PORT,
  VISUAL_DASHBOARD_CONTROL_PORT,
  VISUAL_DASHBOARD_PORT,
  VISUAL_PORT,
} from "./ports.js";

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
  // In CI only: one retry, so a timing hiccup on a slow runner shows as "flaky" in the
  // report instead of blocking the image. A real failure fails both attempts.
  retries: process.env.CI ? 1 : 0,
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
    serve(E2E_PORT, CONTROL_PORT, "default"),
    // Separate instances so specs can't disturb each other's meshes or the baselines.
    serve(VISUAL_PORT, VISUAL_CONTROL_PORT, "default"),
    serve(DASHBOARD_PORT, DASHBOARD_CONTROL_PORT, "dashboard"),
    serve(VISUAL_DASHBOARD_PORT, VISUAL_DASHBOARD_CONTROL_PORT, "dashboard"),
    serve(LARGE_PORT, LARGE_CONTROL_PORT, "large"),
    serve(AUTH_PORT, AUTH_CONTROL_PORT, "default", { E2E_AUTH: "local" }),
    // Injecting 30 days of history takes a while; nothing may change it afterwards.
    {
      ...serve(HISTORY_PORT, HISTORY_CONTROL_PORT, "dashboard", { E2E_HISTORY_DAYS: "30" }),
      timeout: 120_000,
    },
  ],
});

/** One e2e/serve.ts instance (FakeNode on a scenario + the real server + fake tiles). */
function serve(
  port: number,
  controlPort: number,
  scenario: string,
  env: Record<string, string> = {},
) {
  return {
    command: "pnpm exec tsx e2e/serve.ts",
    cwd: "..",
    env: {
      E2E_PORT: String(port),
      E2E_CONTROL_PORT: String(controlPort),
      E2E_SCENARIO: scenario,
      ...env,
    },
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  };
}
