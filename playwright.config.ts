import { defineConfig, devices } from "@playwright/test";

// Playwright config — three viewport projects so the same specs in
// tests/mobile/ run against desktop AND two real mobile presets.
// Desktop hits the spec at 1280×720 (typical laptop); pixel-5 and
// iphone-13 use Playwright's bundled device descriptors so user-agent,
// viewport, devicePixelRatio, hasTouch, and isMobile all match the
// real device.
//
// The dev server: started via `webServer` so `pnpm test:e2e:mobile`
// can run without a separate terminal. PORT is fixed to 3100 so the
// e2e runs don't collide with `pnpm dev` on the default 3000.
//
// COVEN_CAVE_E2E=1 is set in the env so the daemon path can short-
// circuit to a deterministic test stub (today: no-op; tests that
// need a daemon should mock /api/*).

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "pixel-5",
      testMatch: /mobile\/.*\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "iphone-13",
      testMatch: /mobile\/.*\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev -H 127.0.0.1 -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      COVEN_CAVE_E2E: "1",
    },
  },
});
