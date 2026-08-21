import { defineConfig, devices } from "@playwright/test";

// Smoke tests run against a real production build, because that is what the
// owner plays at judging time. `npm test` builds, serves, and drives it.
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${process.env.GLOW_TEST_PORT ?? "4281"}/`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run preview -- --port ${process.env.GLOW_TEST_PORT ?? "4281"} --strictPort`,
    url: `http://127.0.0.1:${process.env.GLOW_TEST_PORT ?? "4281"}/`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
