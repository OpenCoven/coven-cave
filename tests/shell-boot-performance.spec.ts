import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createOnboardingBootstrapState,
  ONBOARDING_BOOTSTRAP_BOUNDARIES,
  type OnboardingBootstrapState,
} from "../src/lib/onboarding-bootstrap";
import { HOME_DRAFT_KEY } from "../src/lib/use-composer-draft";
import {
  daemonConnectionPayload, evaluateShellBootPerformance, shellBootControlStallMs, shellBootLimitMs,
  SHELL_BOOT_PERFORMANCE_PROFILE as profile,
  type ShellBootMode, type ShellBootSample,
} from "./fixtures/shell-boot-performance";

// Shell boot to interactive (#6333, under #6119). Each mode opens 100 fresh
// pages in one primed production context and measures navigation start to the
// first frame in which the Home composer accepts input, then proves it with a
// keystroke. The verdict helper grades the nearest-rank p95 against the
// catalogue ceiling and fails closed on any incomplete trial.

type Probe = {
  stallMs: number;
  frames: number;
  interactiveMs: number | null;
  readyStateAtInteractive: string | null;
};

declare global {
  interface Window { __caveShellBoot: Probe }
}

test.skip(process.env.CAVE_SHELL_PERFORMANCE !== "1", "Run pnpm performance:shell");

const now = new Date().toISOString();
const initialBootstrap = createOnboardingBootstrapState(true);
const completedBootstrap: OnboardingBootstrapState = {
  ...initialBootstrap,
  complete: true,
  needsSetup: false,
  status: "complete",
  stages: initialBootstrap.stages.map((stage) => ({
    ...stage, status: "complete", detail: "Ready in the shell boot fixture.",
  })),
};
const familiars = [
  { id: "cody", display_name: "Cody", role: "Code Familiar", status: "active", icon: "ph:code" },
];
const projects = [{
  id: "alpha", name: "Context alpha", root: "/context/alpha", access: "write", createdAt: now, updatedAt: now,
}];
const sessions = [{
  id: "boot-a", familiarId: "cody", project_root: "/context/alpha", title: "Boot thread A",
  status: "completed", origin: "chat", harness: "codex", exit_code: null,
  archived_at: null, created_at: now, updated_at: now,
  attention: { state: "none", since: null, reason: null },
}];

type Counters = { daemonPolls: number; daemonRunning: boolean | null; externalBlocked: number };

function freshCounters(): Counters {
  return { daemonPolls: 0, daemonRunning: null, externalBlocked: 0 };
}

/**
 * One context per mode: seeded as an already-onboarded workspace, every live
 * mutation refused, every non-origin request aborted, the daemon poll fixed to
 * the mode's state. Counters are swapped per trial by the caller.
 *
 * Request interception disables Chromium's HTTP cache for the whole context,
 * so every trial re-fetches the shell's assets over loopback. "Primed" means
 * the production server and the browser process have already served and run
 * Home once; it does not mean a warm HTTP cache. The report says so.
 */
async function routeShell(context: BrowserContext, baseURL: string, mode: ShellBootMode, counters: () => Counters) {
  await context.addCookies([
    { name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" },
  ]);
  await context.addInitScript((draftKey) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:shell:nav-open", "1");
    // The composer persists its draft on a debounce (use-composer-draft). A
    // previous trial's keystroke that got flushed before its page closed would
    // otherwise be restored here and the next keystroke would read "kk". Every
    // trial boots the shell with an empty composer, which is what the budget
    // describes.
    localStorage.removeItem(draftKey);
  }, HOME_DRAFT_KEY);
  await context.routeWebSocket(() => true, (socket) => socket.close());
  const blockExternal = (route: Route) => {
    counters().externalBlocked += 1;
    return route.abort();
  };
  // Registered first so it runs last: API routes below take precedence.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : blockExternal(route));
  const daemon = daemonConnectionPayload(mode);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // The glob is not origin-scoped; a third-party host with /api/ in its path
    // is still external and must be blocked and counted, not answered.
    if (url.origin !== baseURL) {
      await blockExternal(route);
      return;
    }
    if (request.method() !== "GET") {
      await route.fulfill({ status: 403, json: { ok: false, error: "Fixture forbids live mutations" } });
      return;
    }
    let payload: object = { ok: true };
    if (url.pathname === "/api/onboarding/bootstrap") {
      payload = { ok: true, ...completedBootstrap, boundaries: ONBOARDING_BOOTSTRAP_BOUNDARIES };
    }
    else if (url.pathname === "/api/onboarding/status") payload = { ok: true, complete: true, steps: {}, tools: [] };
    else if (url.pathname === "/api/familiars") payload = { ok: true, familiars };
    else if (url.pathname === "/api/projects") payload = { ok: true, projects };
    else if (url.pathname === "/api/sessions/list") payload = { ok: true, sessions };
    else if (url.pathname === "/api/queue/project") payload = { ok: true, projectId: "alpha", project: projects[0] };
    else if (url.pathname === "/api/daemon/connection") {
      // Record what was actually served, so the sample's daemon state is an
      // observation of this trial rather than a restatement of the mode.
      counters().daemonPolls += 1;
      counters().daemonRunning = daemon.running;
      payload = daemon;
    }
    else if (url.pathname === "/api/memory") payload = { ok: true, entries: [] };
    else if (url.pathname === "/api/board") payload = { ok: true, cards: [] };
    else if (url.pathname === "/api/inbox") payload = { ok: true, items: [] };
    else if (url.pathname === "/api/github/tasks") payload = { ok: true, tasks: [] };
    await route.fulfill({ json: payload });
  });
}

function composerOf(page: Page) {
  return page.getByRole("textbox", { name: profile.composerName, exact: true });
}

for (const mode of profile.modes) {
  test(`${mode} shell boot reaches an interactive Home composer within its production p95 budget`, async ({
    browser, baseURL, extraHTTPHeaders,
  }, testInfo) => {
    test.setTimeout(900_000);
    if (!baseURL || !process.env.CAVE_SHELL_ARTIFACT_ROOT) throw new Error("Missing benchmark invocation");
    const artifactRoot = process.env.CAVE_SHELL_ARTIFACT_ROOT;
    const control = process.env.CAVE_SHELL_CONTROL === "1";
    const limitMs = shellBootLimitMs(mode);
    const samples: Array<ShellBootSample & {
      error?: string; cleanup?: boolean; frames?: number; readyStateAtInteractive?: string | null;
      priorValue?: string;
      ttfbMs?: number; domContentLoadedMs?: number; loadMs?: number; stallMs?: number;
    }> = [];
    const report = {
      invocation: JSON.parse(readFileSync(path.join(artifactRoot, "invocation.json"), "utf8")),
      buildId: readFileSync(path.join(process.cwd(), ".next/BUILD_ID"), "utf8").trim(),
      browser: browser.version(), profile, mode, control, limitMs, samples,
      measurement: "Navigation start to the first animation frame in which the Home composer textarea exists, " +
        "is neither readOnly nor disabled, confirmed by a keystroke landing in its value. Not Lighthouse TTI or INP.",
      limitations: [
        "Production web renderer served by the built standalone server on loopback with synthetic API data",
        "One primed browser context per mode (server and browser process have run Home once); each trial is a fresh page",
        "Request interception disables Chromium's HTTP cache, so every trial re-fetches the shell's assets over loopback; this is not a warm-cache reload",
        mode === "offline"
          ? "Offline means the daemon poll reports the local daemon offline and non-origin requests are aborted; the local server is reachable"
          : "Warm means the daemon poll reports a running local daemon; non-origin requests are aborted in both modes",
        "Native shell, Tauri sidecar start, daemon readiness and real-profile data are excluded",
      ],
      verdict: evaluateShellBootPerformance(mode, samples),
    };
    const output = path.join(artifactRoot, `${mode}.json`);
    const save = () => {
      report.verdict = evaluateShellBootPerformance(mode, samples);
      writeFileSync(output, JSON.stringify(report, null, 2));
    };
    let counters: Counters = freshCounters();
    const context = await browser.newContext({
      baseURL, extraHTTPHeaders, viewport: profile.viewport, serviceWorkers: "block",
    });
    try {
      await routeShell(context, baseURL, mode, () => counters);
      // Prime: the first load of this context is the cold path and is not
      // graded. Wait for the same interactive state the trials measure and for
      // the first daemon poll, so trial 0 pays no first-time work the primer
      // was meant to absorb.
      const primer = await context.newPage();
      await primer.goto(profile.route);
      await expect(composerOf(primer)).toBeEditable({ timeout: 60_000 });
      await expect.poll(() => counters.daemonPolls, { timeout: 30_000 }).toBeGreaterThan(0);
      await primer.close();

      for (let index = 0; index < profile.trials; index++) {
        counters = freshCounters();
        const stallMs = control && index < profile.controlTrials ? shellBootControlStallMs(mode) : 0;
        const sample: typeof samples[number] = {
          index, mode, complete: false, hydrated: false, typedMatches: false,
          daemonPolls: 0, daemonRunning: false, externalBlocked: 0, interactiveMs: NaN, stallMs,
        };
        samples.push(sample);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => { if (errors.length < 5) errors.push(error.message.slice(0, 300)); });
        try {
          await page.addInitScript(({ stallMs, composerName }) => {
            const probe: Probe = { stallMs, frames: 0, interactiveMs: null, readyStateAtInteractive: null };
            window.__caveShellBoot = probe;
            if (stallMs > 0) {
              // Positive control: block the main thread before any page script
              // so the interactive frame cannot arrive inside the ceiling.
              const until = performance.now() + stallMs;
              while (performance.now() < until) { /* intentional control */ }
            }
            const check = () => {
              probe.frames += 1;
              const textarea = document.querySelector<HTMLTextAreaElement>(
                `textarea[aria-label=${JSON.stringify(composerName)}]`,
              );
              if (textarea && !textarea.readOnly && !textarea.disabled) {
                probe.interactiveMs = performance.now();
                probe.readyStateAtInteractive = document.readyState;
                return;
              }
              requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          }, { stallMs, composerName: profile.composerName });
          await page.goto(profile.route, { waitUntil: "commit" });
          await page.waitForFunction(() => window.__caveShellBoot?.interactiveMs != null, undefined, { timeout: 60_000 });
          const composer = composerOf(page);
          const prior = await composer.inputValue();
          await composer.click();
          await page.keyboard.type(profile.keystroke);
          const typed = await composer.inputValue();
          sample.priorValue = prior;
          // The supervisor's first poll is asynchronous and may land after the
          // interactive frame and the keystroke; it is a validity condition, not
          // part of the timing, so wait for it before reading the counters.
          await expect.poll(() => counters.daemonPolls, { timeout: 30_000 }).toBeGreaterThan(0);
          const observed = await page.evaluate((composerName) => {
            const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
            const textarea = document.querySelector<HTMLTextAreaElement>(
              `textarea[aria-label=${JSON.stringify(composerName)}]`,
            );
            return {
              ...window.__caveShellBoot,
              hydrated: textarea ? !textarea.readOnly : false,
              ttfbMs: navigation?.responseStart ?? null,
              domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
              loadMs: navigation?.loadEventEnd ?? null,
            };
          }, profile.composerName);
          if (observed.interactiveMs === null) throw new Error("No interactive frame recorded");
          Object.assign(sample, {
            hydrated: observed.hydrated, typedMatches: prior === "" && typed === profile.keystroke,
            daemonPolls: counters.daemonPolls, daemonRunning: counters.daemonRunning === true,
            externalBlocked: counters.externalBlocked,
            interactiveMs: observed.interactiveMs, frames: observed.frames,
            readyStateAtInteractive: observed.readyStateAtInteractive,
            ttfbMs: observed.ttfbMs ?? undefined, domContentLoadedMs: observed.domContentLoadedMs ?? undefined,
            loadMs: observed.loadMs ?? undefined,
            complete: errors.length === 0,
          });
          if (errors.length) sample.error = errors.join("; ");
          if (index === 0) await page.screenshot({ path: path.join(artifactRoot, `${mode}.png`) });
        } catch (error) {
          sample.error = String(error).slice(0, 1_000);
          sample.complete = false;
        } finally {
          await page.close().then(() => { sample.cleanup = true; })
            .catch(() => { sample.cleanup = false; sample.complete = false; });
          save();
        }
        if (!sample.complete || sample.error) break;
      }
    } finally {
      await context.close().catch(() => {});
      save();
      await testInfo.attach(`${mode}-measurements`, { path: output, contentType: "application/json" });
    }
    expect(report.verdict.failures, JSON.stringify(report.verdict)).toEqual([]);
    expect(report.verdict.pass).toBe(true);
  });
}
