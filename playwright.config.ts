import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const E2E_RUN_ID = randomUUID();
const E2E_PROJECTS_PATH = join(tmpdir(), `cave-e2e-projects-${E2E_RUN_ID}.json`);
const E2E_QUEUE_PROJECT_PATH = join(tmpdir(), `cave-e2e-queue-project-${E2E_RUN_ID}.json`);
const PERSISTED_SCREEN_SCALE_TEST = /persisted screen magnification scales the app without window scroll$/;
const MOBILE_FOUNDATIONS_SPEC = /mobile\/foundations\.spec\.ts/;

// Most existing specs exercise an already-onboarded workspace. Seed that
// baseline explicitly now that chat/home correctly block an empty registry;
// first-project tests can still route /api/projects to an empty response.
writeFileSync(
  E2E_PROJECTS_PATH,
  JSON.stringify({
    version: 1,
    projects: [{
      id: "e2e-project",
      name: "E2E Project",
      root: process.cwd(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
  }),
);
// Queue selection is a separate durable preference. Seed it alongside the
// existing project registry so dismissed-onboarding specs remain an already
// configured baseline; dedicated onboarding tests still mock no/stale-project
// responses explicitly.
writeFileSync(E2E_QUEUE_PROJECT_PATH, JSON.stringify({ version: 1, projectId: "e2e-project" }));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Retry once everywhere: the dev server compiles routes on first hit, so under
  // parallel load a cold route can exceed a test's timeout on the first try and
  // pass once warm. A genuinely broken spec still fails both attempts.
  retries: 1,
  workers: process.env.CI ? 2 : undefined,
  // The webServer is `next dev`, which compiles routes on demand; under parallel
  // load the first interactive paint can run past Playwright's 30s default. Give
  // each test 60s so a busy machine doesn't read slow-compile as a real failure.
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    // Canonical preferences are process-wide rather than browser-origin state.
    // Run the one mutating persistence case in an explicit chain, restore its
    // prior value, then release the normal fully-parallel projects. This keeps
    // the desktop/Chromium-mobile/WebKit coverage without leaking scale=125
    // into unrelated tests or racing another project's cleanup.
    {
      name: "preferences-desktop",
      testMatch: MOBILE_FOUNDATIONS_SPEC,
      grep: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "preferences-pixel-5",
      dependencies: ["preferences-desktop"],
      testMatch: MOBILE_FOUNDATIONS_SPEC,
      grep: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "preferences-iphone-13",
      dependencies: ["preferences-pixel-5"],
      testMatch: MOBILE_FOUNDATIONS_SPEC,
      grep: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "desktop",
      dependencies: ["preferences-iphone-13"],
      testMatch: /.*\.spec\.ts/,
      grepInvert: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "pixel-5",
      dependencies: ["preferences-iphone-13"],
      testMatch: /mobile\/.*\.spec\.ts/,
      grepInvert: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "iphone-13",
      dependencies: ["preferences-iphone-13"],
      testMatch: /mobile\/.*\.spec\.ts/,
      grepInvert: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev -H 127.0.0.1 -p ${PORT}`,
    url: BASE_URL,
    // The availability probe waits on the FIRST dev compile of "/", which can
    // run past two minutes on a loaded machine (observed 2m51s cold /
    // 1m51s warm on 2026-07-19); 120s read slow-compile as a dead server.
    timeout: 240_000,
    // Preference tests mutate the canonical app-owned store. Never attach them
    // to an arbitrary server that may be using the developer's real ~/.coven.
    reuseExistingServer: false,
    env: {
      COVEN_CAVE_E2E: "1",
      // Keep app-owned preferences and backdrop bytes out of the developer's
      // real ~/.coven directory. A per-config UUID prevents concurrent runs or
      // later PID reuse from sharing stale state while remaining stable for
      // every request in this run.
      COVEN_PREFERENCES_PATH: join(tmpdir(), `cave-e2e-preferences-${E2E_RUN_ID}.json`),
      CAVE_PROJECTS_PATH_OVERRIDE: E2E_PROJECTS_PATH,
      CAVE_QUEUE_PROJECT_PATH_OVERRIDE: E2E_QUEUE_PROJECT_PATH,
      COVEN_BACKDROP_PATH: join(tmpdir(), `cave-e2e-backdrop-${E2E_RUN_ID}.jpg`),
      COVEN_THEME_PATH: join(tmpdir(), `cave-e2e-theme-${E2E_RUN_ID}.json`),
    },
  },
});
