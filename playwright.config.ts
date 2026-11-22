import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4100);

/**
 * E2E runs against the real production server (`next start` of the real build,
 * with migrations applied to a fresh database) — not a dev server, not a mock.
 *
 * 4100 sits in the same 4xxx port family as the local app port (4000) and is
 * never 3000, which on this machine belongs to an unrelated dev server.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    port,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
