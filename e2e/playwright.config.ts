/**
 * End-to-end configuration.
 *
 * Both servers are started by Playwright itself so a run needs no manual setup.
 * The backend is pointed at a disposable copy of `data/` (see
 * fixtures/globalSetup.ts), because these journeys write real bookings, service
 * records and invoices -- running them against the repository's committed data
 * would corrupt it.
 *
 * `reuseExistingServer` is off on purpose. A developer's own backend would be
 * writing into the real `data/` directory, and silently reusing it would send
 * these journeys straight at production-shaped data. Failing on a busy port is
 * the safer outcome.
 */

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

import { E2E_DATA_DIR, E2E_ADMIN_TOKEN, BACKEND_PORT, FRONTEND_PORT } from "./fixtures/env";

const repoRoot = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.artifacts",
  fullyParallel: false,
  /**
   * One worker. The journeys share a single backend and a single data
   * directory, and several assert on absolute counts -- an invoice import
   * racing a waste recording would change a number another test is checking.
   */
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "./.report" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node server.js",
      cwd: path.join(repoRoot, "backend"),
      port: BACKEND_PORT,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      env: {
        ZEROWASTE_DATA_DIR: E2E_DATA_DIR,
        PORT: String(BACKEND_PORT),
        // The frontend ships this literal, so the backend has to accept it.
        ADMIN_TOKEN: E2E_ADMIN_TOKEN,
      },
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      cwd: path.join(repoRoot, "frontend"),
      port: FRONTEND_PORT,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
      env: { VITE_API_BASE: `http://localhost:${BACKEND_PORT}` },
    },
  ],
  globalSetup: "./fixtures/globalSetup.ts",
  globalTeardown: "./fixtures/globalTeardown.ts",
});
