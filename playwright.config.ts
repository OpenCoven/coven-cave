import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePort } from "./scripts/ports.mjs";

// Playwright config — three viewport projects so the same specs in
// tests/mobile/ run against desktop AND two real mobile presets.
// Desktop hits the spec at 1280×720 (typical laptop); pixel-5 and
// iphone-13 use Playwright's bundled device descriptors so user-agent,
// viewport, devicePixelRatio, hasTouch, and isMobile all match the
// real device.
//
// The dev server: started via `webServer` so `pnpm test:e2e:mobile`
// can run without a separate terminal. The port is fixed at the e2e
// entry of the shared contract (scripts/ports.mjs) so e2e runs collide
// neither with `pnpm dev` on 3000 nor with a packaged build on 3020.
//
// COVEN_CAVE_E2E=1 is set in the env so the daemon path can short-
// circuit to a deterministic test stub (today: no-op; tests that
// need a daemon should mock /api/*).

const PORT = resolvePort("e2e", process.env);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const E2E_RUN_ID = randomUUID();
const E2E_PROJECTS_PATH = join(tmpdir(), `cave-e2e-projects-${E2E_RUN_ID}.json`);
const E2E_QUEUE_PROJECT_PATH = join(tmpdir(), `cave-e2e-queue-project-${E2E_RUN_ID}.json`);
const E2E_PROJECT_PERMISSIONS_PATH = join(tmpdir(), `cave-e2e-project-permissions-${E2E_RUN_ID}.json`);
const E2E_COVEN_HOME = join(tmpdir(), `cave-e2e-coven-${E2E_RUN_ID}`);
const E2E_CAVE_HOME = join(tmpdir(), `cave-e2e-cave-${E2E_RUN_ID}`);
const E2E_COVEN_SOCKET = join(tmpdir(), `cave-e2e-socket-${E2E_RUN_ID}.sock`);
const E2E_LOCAL_PEER_FIXTURE = "cave-e2e-local-peer-fixture";
const E2E_MOBILE_ACCESS_FIXTURE = "test-fixture";

const PERSISTED_SCREEN_SCALE_TEST = /persisted screen magnification scales the app without window scroll$/;
const SETUP_FOCUS_VISIBILITY_TEST = /keeps setup controls focus-visible in WebKit$/;
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
writeFileSync(
  E2E_PROJECT_PERMISSIONS_PATH,
  JSON.stringify({
    version: 2,
    projectGrants: [{
      familiarId: "nova",
      projectId: "e2e-project",
      access: "write",
      source: "human",
      grantedAt: "2026-01-01T00:00:00.000Z",
    }],
    accessGroups: [],
    grantProposals: [],
    permissionAudit: [],
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
    // next dev has no outer server.ts TCP peer stamper. Give ordinary E2E
    // pages the equivalent deterministic local-peer proof; the paired-mobile
    // boundary spec deliberately overrides it with an invalid value and a
    // synthetic mobile credential so proxy.ts owns the ingress marker.
    extraHTTPHeaders: {
      "x-coven-cave-local-peer": E2E_LOCAL_PEER_FIXTURE,
      // COVEN_CAVE_ACCESS_TOKEN is armed on the webServer, so it is armed for
      // EVERY project — and since loopback stopped counting as identity
      // (cave-ruw4z), every e2e client is an access-gated client. The
      // local-peer stamp marks a request direct rather than forwarded, which
      // is routing, not a credential.
      //
      // Scoping this to only the mutating `preferences-*` chain was wrong and
      // failed loudly: every other project's page loads sat on the gate for
      // their full 45s timeout, and the job was cancelled at ~63 minutes.
      // The paired-mobile boundary spec still owns its own ingress, because it
      // overrides `extraHTTPHeaders` wholesale rather than inheriting this.
      authorization: `Bearer ${E2E_MOBILE_ACCESS_FIXTURE}`,
    },
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
      name: "setup-focus-webkit",
      dependencies: ["preferences-iphone-13"],
      testMatch: /onboarding-wizard\.spec\.ts/,
      grep: SETUP_FOCUS_VISIBILITY_TEST,
      use: { ...devices["Desktop Safari"] },
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
      // Crafts stay hidden in production by default. Their dedicated E2E
      // specs exercise the explicitly enabled surface through this fixture.
      NEXT_PUBLIC_CAVE_CRAFTS: "1",
      // Keep app-owned preferences and backdrop bytes out of the developer's
      // real ~/.coven directory. A per-config UUID prevents concurrent runs or
      // later PID reuse from sharing stale state while remaining stable for
      // every request in this run.
      COVEN_PREFERENCES_PATH: join(tmpdir(), `cave-e2e-preferences-${E2E_RUN_ID}.json`),
      // Route every remaining server-side home/socket lookup into this run's
      // synthetic state. Targeted browser routes mock memory payloads, but
      // project dependencies and shell boot probes must also never inspect a
      // maintainer's genuine Coven/Cave homes.
      COVEN_HOME: E2E_COVEN_HOME,
      COVEN_CAVE_HOME: E2E_CAVE_HOME,
      COVEN_SOCKET: E2E_COVEN_SOCKET,
      COVEN_CAVE_LOCAL_PEER_SECRET: E2E_LOCAL_PEER_FIXTURE,
      COVEN_CAVE_ACCESS_TOKEN: E2E_MOBILE_ACCESS_FIXTURE,
      CAVE_PROJECTS_PATH_OVERRIDE: E2E_PROJECTS_PATH,
      CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: E2E_PROJECT_PERMISSIONS_PATH,
      CAVE_QUEUE_PROJECT_PATH_OVERRIDE: E2E_QUEUE_PROJECT_PATH,
      COVEN_BACKDROP_PATH: join(tmpdir(), `cave-e2e-backdrop-${E2E_RUN_ID}.jpg`),
      COVEN_THEME_PATH: join(tmpdir(), `cave-e2e-theme-${E2E_RUN_ID}.json`),
    },
  },
});
