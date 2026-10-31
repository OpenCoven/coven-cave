import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createOnboardingBootstrapState,
  ONBOARDING_BOOTSTRAP_BOUNDARIES,
  type OnboardingBootstrapState,
} from "../src/lib/onboarding-bootstrap";
import { HOME_DRAFT_KEY } from "../src/lib/use-composer-draft";
import {
  evaluateSoakPerformance, expectedSoakSamples,
  SOAK_PERFORMANCE_PROFILE as profile,
  type SoakSample,
} from "./fixtures/soak-performance";

// Production soak (#6347, under #6119). One page stays alive for the requested
// minutes, cycling through Home modes; once a minute the lane forces a GC and
// samples the server process, the page and the synthetic state root. The
// verdict reports growth per hour and fails closed on an incomplete run. It
// grades no ceiling: the catalogue has no soak budgets yet.

test.skip(process.env.CAVE_SOAK_PERFORMANCE !== "1", "Run pnpm performance:soak");

const now = new Date().toISOString();
const initialBootstrap = createOnboardingBootstrapState(true);
const completedBootstrap: OnboardingBootstrapState = {
  ...initialBootstrap, complete: true, needsSetup: false, status: "complete",
  stages: initialBootstrap.stages.map((stage) => ({ ...stage, status: "complete", detail: "Ready in the soak fixture." })),
};
const familiars = [{ id: "cody", display_name: "Cody", role: "Code Familiar", status: "active", icon: "ph:code" }];
const projects = [{ id: "alpha", name: "Context alpha", root: "/context/alpha", access: "write", createdAt: now, updatedAt: now }];
const sessions = [{
  id: "soak-a", familiarId: "cody", project_root: "/context/alpha", title: "Soak thread A",
  status: "completed", origin: "chat", harness: "codex", exit_code: null,
  archived_at: null, created_at: now, updated_at: now, attention: { state: "none", since: null, reason: null },
}];

type Counters = { daemonPolls: number; externalBlocked: number; apiRequests: number };

async function routeSoak(context: BrowserContext, baseURL: string, counters: Counters) {
  await context.addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
  await context.addInitScript((draftKey) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:shell:nav-open", "1");
    localStorage.removeItem(draftKey);
  }, HOME_DRAFT_KEY);
  await context.routeWebSocket(() => true, (socket) => socket.close());
  const blockExternal = (route: Route) => { counters.externalBlocked += 1; return route.abort(); };
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : blockExternal(route));
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== baseURL) { await blockExternal(route); return; }
    counters.apiRequests += 1;
    if (request.method() !== "GET") {
      await route.fulfill({ status: 403, json: { ok: false, error: "Fixture forbids live mutations" } });
      return;
    }
    let payload: object = { ok: true };
    if (url.pathname === "/api/onboarding/bootstrap") payload = { ok: true, ...completedBootstrap, boundaries: ONBOARDING_BOOTSTRAP_BOUNDARIES };
    else if (url.pathname === "/api/onboarding/status") payload = { ok: true, complete: true, steps: {}, tools: [] };
    else if (url.pathname === "/api/familiars") payload = { ok: true, familiars };
    else if (url.pathname === "/api/projects") payload = { ok: true, projects };
    else if (url.pathname === "/api/sessions/list") payload = { ok: true, sessions };
    else if (url.pathname === "/api/queue/project") payload = { ok: true, projectId: "alpha", project: projects[0] };
    else if (url.pathname === "/api/daemon/connection") {
      counters.daemonPolls += 1;
      payload = { ok: true, running: true, availability: "online", targetMode: "local" };
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

function listeningPid(port: number): number {
  const out = execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  const pids = out.split(/\s+/).filter(Boolean).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
  if (pids.length !== 1) throw new Error(`expected one listener on ${port}, found ${JSON.stringify(pids)}`);
  return pids[0];
}

function serverRssBytes(pid: number): number {
  const kb = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim());
  if (!Number.isFinite(kb) || kb <= 0) throw new Error(`no resident set for pid ${pid}`);
  return kb * 1024;
}

function serverFdCount(pid: number): number | null {
  try {
    if (process.platform === "linux") return readdirSync(`/proc/${pid}/fd`).length;
    const out = execFileSync("lsof", ["-nP", "-p", String(pid)], { encoding: "utf8" });
    return Math.max(0, out.trim().split("\n").length - 1);
  } catch { return null; }
}

function directoryBytes(root: string): number {
  let total = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
  };
  walk(root);
  return total;
}

test("the production shell holds steady resource counts over a sustained soak", async ({ browser, baseURL, extraHTTPHeaders }, testInfo) => {
  const minutes = Number(process.env.CAVE_SOAK_MINUTES);
  if (!baseURL || !process.env.CAVE_SOAK_ARTIFACT_ROOT || !process.env.CAVE_SOAK_STATE_ROOT || !Number.isInteger(minutes)) {
    throw new Error("Missing soak invocation");
  }
  test.setTimeout(minutes * 60_000 + 15 * 60_000);
  const artifactRoot = process.env.CAVE_SOAK_ARTIFACT_ROOT;
  const stateRoot = process.env.CAVE_SOAK_STATE_ROOT;
  const port = Number(new URL(baseURL).port);
  const samples: SoakSample[] = [];
  const modeErrors: Record<string, number> = {};
  const report = {
    invocation: JSON.parse(readFileSync(path.join(artifactRoot, "invocation.json"), "utf8")),
    buildId: readFileSync(path.join(process.cwd(), ".next/BUILD_ID"), "utf8").trim(),
    browser: browser.version(), profile, minutes, expectedSamples: expectedSoakSamples(minutes),
    server: { pid: 0 }, samples, modeErrors, pageErrorMessages: [] as string[],
    measurement: "Once a minute after a forced garbage collection: server resident set and open descriptors, " +
      "page retained JS heap, DOM nodes, listeners, documents and frames, and bytes under the synthetic state root. " +
      "The verdict is the least-squares growth per hour over the final two thirds of samples; no ceiling is graded.",
    limitations: [
      "Production web renderer served by the built standalone server on loopback with synthetic API data",
      "One page in one primed context cycling Home modes by client navigation; no stream turn, no daemon, no provider",
      "Request interception disables Chromium's HTTP cache and aborts every non-origin request",
      "Native shell, Tauri sidecar, real daemon, real profile and iOS are excluded",
    ],
    verdict: evaluateSoakPerformance(samples, minutes),
  };
  const output = path.join(artifactRoot, "soak.json");
  const save = () => {
    report.verdict = evaluateSoakPerformance(samples, minutes);
    writeFileSync(output, JSON.stringify(report, null, 2));
  };
  const counters: Counters = { daemonPolls: 0, externalBlocked: 0, apiRequests: 0 };
  const context = await browser.newContext({ baseURL, extraHTTPHeaders, viewport: profile.viewport, serviceWorkers: "block" });
  let pageErrors = 0;
  let cycles = 0;
  try {
    await routeSoak(context, baseURL, counters);
    const page = await context.newPage();
    let currentMode = "home";
    page.on("pageerror", (error) => {
      pageErrors += 1;
      modeErrors[currentMode] = (modeErrors[currentMode] ?? 0) + 1;
      if (report.pageErrorMessages.length < 20) report.pageErrorMessages.push(`${currentMode}: ${error.message.slice(0, 300)}`);
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");
    await page.goto(profile.homeRoute);
    await expect(composerOf(page)).toBeEditable({ timeout: 60_000 });
    await expect.poll(() => counters.daemonPolls, { timeout: 30_000 }).toBeGreaterThan(0);
    const pid = listeningPid(port);
    report.server.pid = pid;
    const start = Date.now();
    const sample = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? NaN;
      samples.push({
        index: samples.length, atMs: Date.now() - start, cycles, pageErrors, externalBlocked: counters.externalBlocked,
        server: { pid, rssBytes: serverRssBytes(pid), fdCount: serverFdCount(pid) },
        page: {
          jsHeapUsedBytes: metric("JSHeapUsedSize"), jsHeapTotalBytes: metric("JSHeapTotalSize"),
          domNodes: metric("Nodes"), jsEventListeners: metric("JSEventListeners"),
          documents: metric("Documents"), frames: metric("Frames"),
        },
        stateBytes: directoryBytes(stateRoot),
      });
      save();
    };
    await sample();
    await page.screenshot({ path: path.join(artifactRoot, "first.png") });
    const deadline = start + minutes * 60_000;
    let nextSampleAt = start + profile.sampleIntervalMs;
    while (Date.now() < deadline) {
      for (const mode of profile.modes) {
        currentMode = mode;
        await page.goto(`/?mode=${mode}`, { waitUntil: "load" });
        await page.waitForTimeout(profile.dwellMs);
        if (Date.now() >= nextSampleAt) { await sample(); nextSampleAt += profile.sampleIntervalMs; }
      }
      currentMode = "home";
      await page.goto(profile.homeRoute, { waitUntil: "load" });
      await expect(composerOf(page)).toBeEditable({ timeout: 60_000 });
      cycles += 1;
      if (Date.now() >= nextSampleAt) { await sample(); nextSampleAt += profile.sampleIntervalMs; }
    }
    currentMode = "home";
    await page.goto(profile.homeRoute, { waitUntil: "load" });
    await expect(composerOf(page)).toBeEditable({ timeout: 60_000 });
    while (samples.length < expectedSoakSamples(minutes)) await sample();
    await page.screenshot({ path: path.join(artifactRoot, "last.png") });
  } finally {
    await context.close().catch(() => {});
    save();
    await testInfo.attach("soak-measurements", { path: output, contentType: "application/json" });
  }
  expect(report.verdict.failures, JSON.stringify(report.verdict)).toEqual([]);
  expect(report.verdict.pass).toBe(true);
});
