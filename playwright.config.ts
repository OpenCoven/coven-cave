import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { resolvePort } from "./scripts/ports.mjs";
import { SOAK_PERFORMANCE_PROFILE } from "./tests/fixtures/soak-performance.ts";

// Playwright config — three viewport projects so the same specs in
// tests/mobile/ run against desktop AND two real mobile presets.
// Desktop hits the spec at 1280×720 (typical laptop); pixel-5 and
// iphone-13 use Playwright's bundled device descriptors so user-agent,
// viewport, devicePixelRatio, hasTouch, and isMobile all match the
// real device.
//
// CI builds and serves the production app: a long-lived Turbopack dev graph
// can abort while restoring evicted tasks (#6114). Local runs retain the dev
// server for quick iteration. Both are owned by `webServer`, so tests can run
// without a separate terminal. The port is fixed at the e2e
// entry of the shared contract (scripts/ports.mjs) so e2e runs collide
// neither with `pnpm dev` on 3000 nor with a packaged build on 3020.
//
// COVEN_CAVE_E2E=1 is set in the env so the daemon path can short-
// circuit to a deterministic test stub (today: no-op; tests that
// need a daemon should mock /api/*).

const PORT = resolvePort("e2e", process.env);
// The browser performance gates (stream, shell boot) always run the production
// server against an isolated state root their launcher created; a bare
// `playwright test` cannot opt into them.
const streamPerformance = process.env.CAVE_STREAM_PERFORMANCE === "1";
const shellPerformance = process.env.CAVE_SHELL_PERFORMANCE === "1";
const doctorPerformance = process.env.CAVE_DOCTOR_PERFORMANCE === "1";
const soakPerformance = process.env.CAVE_SOAK_PERFORMANCE === "1";
const browserPerformance = streamPerformance || shellPerformance || doctorPerformance || soakPerformance;
const performanceStateRoot = streamPerformance
  ? process.env.CAVE_STREAM_STATE_ROOT
  : shellPerformance
    ? process.env.CAVE_SHELL_STATE_ROOT
    : doctorPerformance
      ? process.env.CAVE_DOCTOR_STATE_ROOT
      : process.env.CAVE_SOAK_STATE_ROOT;
if (browserPerformance && (!performanceStateRoot || !isAbsolute(performanceStateRoot) || !existsSync(performanceStateRoot))) {
  throw new Error("Run the browser performance gates with pnpm performance:stream, pnpm performance:shell, pnpm performance:doctor or pnpm performance:soak for isolated state");
}
// The soak lane's duration is its only input (#6347). The launcher validates
// it; a direct spec invocation is refused here rather than after the build.
const soakMinutes = soakPerformance ? Number(process.env.CAVE_SOAK_MINUTES) : 0;
if (soakPerformance && (!Number.isInteger(soakMinutes)
  || soakMinutes < SOAK_PERFORMANCE_PROFILE.minimumMinutes || soakMinutes > SOAK_PERFORMANCE_PROFILE.maximumMinutes)) {
  throw new Error(`Run the soak lane with pnpm performance:soak [--minutes N]; CAVE_SOAK_MINUTES must be an integer from ${SOAK_PERFORMANCE_PROFILE.minimumMinutes} to ${SOAK_PERFORMANCE_PROFILE.maximumMinutes}`);
}
const fixtureTmpRoot = browserPerformance ? performanceStateRoot! : tmpdir();
const productionE2E = !!process.env.CI || browserPerformance;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const E2E_RUN_ID = randomUUID();
const E2E_PROJECTS_PATH = join(fixtureTmpRoot, `cave-e2e-projects-${E2E_RUN_ID}.json`);
const E2E_QUEUE_PROJECT_PATH = join(fixtureTmpRoot, `cave-e2e-queue-project-${E2E_RUN_ID}.json`);
const E2E_PROJECT_PERMISSIONS_PATH = join(fixtureTmpRoot, `cave-e2e-project-permissions-${E2E_RUN_ID}.json`);
const E2E_COVEN_HOME = join(fixtureTmpRoot, `cave-e2e-coven-${E2E_RUN_ID}`);
const E2E_CAVE_HOME = join(fixtureTmpRoot, `cave-e2e-cave-${E2E_RUN_ID}`);
const E2E_COVEN_SOCKET = join(fixtureTmpRoot, `cave-e2e-socket-${E2E_RUN_ID}.sock`);
const E2E_LOCAL_PEER_FIXTURE = "cave-e2e-local-peer-fixture";
const E2E_MOBILE_ACCESS_FIXTURE = "test-fixture";
const E2E_AGENTIC_RECOMMENDATIONS =
  process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS ?? "false";

const PERSISTED_SCREEN_SCALE_TEST = /persisted screen magnification scales the app without window scroll$/;
const SETUP_FOCUS_VISIBILITY_TEST =
  /keeps setup (?:controls focus-visible|diagnostics focus contained) in WebKit$/;
const MOBILE_FOUNDATIONS_SPEC = /mobile\/foundations\.spec\.ts/;
// inbox-toast-chrome-clearance lives at the root rather than in tests/mobile/
// on purpose: the toast-over-chrome collision it guards exists at desktop
// widths too (cave-lcxc6), so it has to run on all three viewport projects —
// tests/mobile/ is excluded from the desktop project.
// composer-environment-popover joins it for the same reason (#5958): the
// branch chip's Environment popover opens at every width, and the phone
// cases (rest-state chips, 44px rows, viewport containment) only run there.
const MOBILE_SURFACE_SPECS =
  /(?:mobile\/.*|right-chat-panel|inbox-toast-chrome-clearance|composer-environment-popover)\.spec\.ts/;
// Not a `.spec.ts`, so no ordinary project's testMatch picks it up.
const WARMUP_SETUP = /warmup\.setup\.ts/;

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
  // The global timeout covers the production build (the server readiness
  // budget is 20 minutes) plus the measurement. The shell gate runs two modes
  // of up to 15 minutes each; the doctor gate's worst case is 100 trials at
  // the 6 s ceiling plus the route's termination grace (about 12 minutes); the
  // stream gate's two patterns fit its original 20 minutes; the soak lane runs
  // for its requested minutes after the build (#6347).
  globalTimeout: soakPerformance
    ? (soakMinutes + 35) * 60_000
    : shellPerformance || doctorPerformance ? 35 * 60_000 : streamPerformance ? 20 * 60_000 : undefined,
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
    // Under `next dev` a `next/dynamic` chunk is COMPILED on first open, so the
    // first test to open a lazy surface pays that cold compile inside its own
    // assertion budget — 28.3s cold vs 2-3s warm, against 30s timeouts, which
    // is exactly why keyboard-shortcuts and task-work-fit rotated between
    // "flaky" and "failed" on CI (cave-ct2k7). Pay it once here instead.
    {
      name: "warmup",
      testMatch: WARMUP_SETUP,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "preferences-desktop",
      dependencies: ["warmup"],
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
      // tests/mobile/** belongs to the pixel-5 and iphone-13 projects below.
      // Without this, `/.*\.spec\.ts/` also matches them and every mobile spec
      // runs a THIRD time under Desktop Chrome. That was survivable only while
      // mobile specs happened to be viewport-agnostic; the first one that
      // genuinely is not (tests/mobile/workspace-half-split.spec.ts, asserting
      // the container-width tab fallback) fails all 22 of its cases there and
      // burns ~4.5 minutes locally. Doubled by `retries: 1` and multiplied on
      // CI's slower runners, that is what pushed the job past its 60-minute cap
      // so every PR reported a bare "cancelled" with no failing test (cave-3wmla).
      //
      // Anchor on the `tests/mobile/` SEGMENT, not a bare `mobile/`: Playwright
      // matches testIgnore against the ABSOLUTE path, so a loose pattern also
      // matches any checkout whose own directory contains "mobile" — a worktree
      // named `…-ignores-mobile` silently ignored EVERY desktop spec and the
      // project collected 0 tests. That would still have looked green on CI,
      // whose runner path has no such segment.
      testIgnore: /[\\/]tests[\\/]mobile[\\/]/,
      grepInvert: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "automations-webkit",
      dependencies: ["preferences-iphone-13"],
      testMatch: /automations-occurrence-reader\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "voice-webkit",
      dependencies: ["preferences-iphone-13"],
      testMatch: /voice-call\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
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
      testMatch: MOBILE_SURFACE_SPECS,
      grepInvert: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "iphone-13",
      dependencies: ["preferences-iphone-13"],
      testMatch: MOBILE_SURFACE_SPECS,
      grepInvert: PERSISTED_SCREEN_SCALE_TEST,
      use: { ...devices["iPhone 13"] },
    },
    {
      // Tablet-width project for the right Chat drawer's non-full-bleed case
      // (cave-4snk9): pixel-5 (393px) and iphone-13 (390px) are the only
      // mobile projects and both are full-bleed (≤480px), so no project
      // exercised the right-chat backdrop at a width where the pointer path
      // exists. iPad Mini is 768×1024 — the drawer is capped at 480px and
      // the backdrop is genuinely reachable along the left edge. Scoped to
      // right-chat-panel.spec.ts only: the rest of tests/mobile/ was written
      // for phone widths and must keep running on the phone projects alone.
      name: "tablet",
      dependencies: ["preferences-iphone-13"],
      testMatch: /right-chat-panel\.spec\.ts/,
      use: { ...devices["iPad Mini"] },
    },
  ],
  webServer: {
    command: productionE2E
      ? `pnpm build && node scripts/start-playwright-production.mjs ${PORT}`
      : `pnpm exec next dev -H 127.0.0.1 -p ${PORT}`,
    url: BASE_URL,
    stdout: productionE2E ? "pipe" : "ignore",
    // The availability probe waits on the FIRST dev compile of "/", which can
    // run past two minutes on a loaded machine (observed 2m51s cold /
    // 1m51s warm on 2026-07-19); 120s read slow-compile as a dead server.
    // CI readiness includes the full production build and its budget/trace
    // gates. This does not increase any browser test or assertion timeout.
    timeout: productionE2E ? 1_200_000 : 240_000,
    // Preference tests mutate the canonical app-owned store. Never attach them
    // to an arbitrary server that may be using the developer's real ~/.coven.
    reuseExistingServer: false,
    env: {
      ...(browserPerformance ? {
        HOME: join(fixtureTmpRoot, "home"),
        USERPROFILE: join(fixtureTmpRoot, "home"),
        XDG_CONFIG_HOME: join(fixtureTmpRoot, "config"),
        XDG_CACHE_HOME: join(fixtureTmpRoot, "cache"),
        XDG_DATA_HOME: join(fixtureTmpRoot, "data"),
        COVEN_CAVE_ENV_FILE: join(fixtureTmpRoot, "cave.env"),
        COVEN_VAULT_FILE: join(fixtureTmpRoot, "vault.yaml"),
        COVEN_GITHUB_SUBSCRIPTIONS_PATH: join(fixtureTmpRoot, "subscriptions.json"),
        COVEN_RESEARCH_ENABLED: "0",
      } : {}),
      COVEN_CAVE_E2E: "1",
      // The existing suite covers every registered room, as next dev did.
      // Keep that explicit in fixture builds; released apps keep their allowlist.
      // Only the stream benchmark may measure another visibility (#6338); its
      // runner validates CAVE_STREAM_ROOMS and records it with the evidence.
      NEXT_PUBLIC_CAVE_ROOMS: (streamPerformance && process.env.CAVE_STREAM_ROOMS) || "all",
      // Local dev-mode E2E only; the CI production server has no compiler.
      // Full Turbopack eviction only runs after a filesystem-cache snapshot.
      // Next 16.3's own eviction fixture removes the minimum active window and
      // shortens the idle checkpoint so a cold multi-surface compile can be
      // persisted and reclaimed before the next one. Without these timings,
      // shard 3 reached 19.67 GiB across next-server and its compiler children
      // before the first eviction; with them it repeatedly reclaimed at a
      // 12.70 GiB combined peak and completed all 51 tests.
      TURBO_ENGINE_SNAPSHOT_IDLE_TIMEOUT_MILLIS: "1000",
      TURBO_ENGINE_SNAPSHOT_MIN_ACTIVE_TIME_MILLIS: "0",
      // Crafts stay hidden in production by default. Their dedicated E2E
      // specs exercise the explicitly enabled surface through this fixture.
      NEXT_PUBLIC_CAVE_CRAFTS: "1",
      // Agentic recommendations stay disabled by default. Their E2E journeys
      // require an explicit NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS=1 opt-in,
      // so ordinary browser coverage exercises the production-safe default.
      NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS: E2E_AGENTIC_RECOMMENDATIONS,
      // Keep app-owned preferences and backdrop bytes out of the developer's
      // real ~/.coven directory. A per-config UUID prevents concurrent runs or
      // later PID reuse from sharing stale state while remaining stable for
      // every request in this run.
      COVEN_PREFERENCES_PATH: join(fixtureTmpRoot, `cave-e2e-preferences-${E2E_RUN_ID}.json`),
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
      COVEN_BACKDROP_PATH: join(fixtureTmpRoot, `cave-e2e-backdrop-${E2E_RUN_ID}.jpg`),
      COVEN_THEME_PATH: join(fixtureTmpRoot, `cave-e2e-theme-${E2E_RUN_ID}.json`),
    },
  },
});
