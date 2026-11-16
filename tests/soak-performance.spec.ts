import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createOnboardingBootstrapState,
  ONBOARDING_BOOTSTRAP_BOUNDARIES,
  type OnboardingBootstrapState,
} from "../src/lib/onboarding-bootstrap";
import type { JournalMemoryStats } from "../src/lib/journal-memory-stats";
import type { JournalRecord } from "../src/lib/server/journal-store";
import { HOME_DRAFT_KEY } from "../src/lib/use-composer-draft";
import { directoryBytes } from "../scripts/worktree-hygiene.mjs";
import {
  dueSoakHeapSnapshots, evaluateSoakPerformance, expectedSoakSamples,
  SOAK_PERFORMANCE_PROFILE as profile,
  type SoakMode, type SoakSample,
} from "./fixtures/soak-performance";

// Production soak (#6347, under #6119). One page stays alive for the requested
// minutes, switching between Home modes in place through the shell's own
// navigation event so the document is never reloaded; once a minute, at
// wall-clock slots, the lane forces a GC and samples the server process tree,
// the page and the synthetic state root. The verdict reports growth per hour
// and fails closed on an incomplete run. It grades no ceiling: the catalogue
// has no soak budgets yet.

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
    else if (url.pathname === "/api/journal") {
      const date = url.searchParams.get("date");
      if (!date) payload = { ok: true, days: [] };
      else if (url.searchParams.has("stats")) payload = {
        ok: true, date, stats: { covenOrigin: 0, externalRuntimes: 0, runtimeMemory: 0 } satisfies JournalMemoryStats, context: "", sources: [],
      };
      else payload = { ok: true, ...({
        date, exists: false, entry: { reflectedBy: null, generatedAt: null, reflection: "" }, modified: null, source: null,
      } satisfies JournalRecord) };
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

function serverFdCount(pid: number): number | null {
  try {
    if (process.platform === "linux") return readdirSync(`/proc/${pid}/fd`).length;
    const out = execFileSync("lsof", ["-nP", "-p", String(pid)], { encoding: "utf8" });
    return Math.max(0, out.trim().split("\n").length - 1);
  } catch { return null; }
}

/**
 * Resident set of the listening process and every descendant (a worker or a
 * forked renderer leaking would otherwise be invisible), with the root's own
 * share and the tree size so the report names what it covers.
 */
function serverProcessTree(rootPid: number): { rssBytes: number; rootRssBytes: number; processes: number } {
  const out = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" });
  const children = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const line of out.trim().split("\n")) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isFinite(kb)) continue;
    rss.set(pid, kb * 1024);
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  if (!rss.has(rootPid)) throw new Error(`Server pid ${rootPid} is not running`);
  let rssBytes = 0;
  let processes = 0;
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    rssBytes += rss.get(pid) ?? 0;
    processes += 1;
    stack.push(...(children.get(pid) ?? []));
  }
  return { rssBytes, rootRssBytes: rss.get(rootPid)!, processes };
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
  const modeVisits: Record<string, number> = {};
  const report = {
    invocation: JSON.parse(readFileSync(path.join(artifactRoot, "invocation.json"), "utf8")),
    buildId: readFileSync(path.join(process.cwd(), ".next/BUILD_ID"), "utf8").trim(),
    browser: browser.version(), profile, minutes, expectedSamples: expectedSoakSamples(minutes),
    errorCounts: { pageErrors: 0, consoleErrors: 0, browserDiagnostics: 0 },
    completed: false, runError: null as string | null,
    heapSnapshots: [] as { minute: number; sampleIndex: number; atMs: number; file: string }[],
    server: { pid: 0 }, samples, modeVisits, modeErrors, pageErrorMessages: [] as string[], consoleErrorMessages: [] as string[], browserErrorMessages: [] as string[],
    measurement: "Once a minute at wall-clock slots, after a forced garbage collection: resident set of the server process tree, " +
      "open descriptors of the listening process, page retained JS heap, DOM nodes, listeners, documents and frames on the " +
      "retained document, and bytes under the synthetic state root. The verdict is the least-squares growth per hour over " +
      "the final two thirds of each series; no ceiling is graded.",
    limitations: [
      "Production web renderer served by the built standalone server on loopback with synthetic API data",
      "One page in one primed context switching Home modes in place through the shell's navigate-mode event; no stream turn, no daemon, no provider",
      "Request interception disables Chromium's HTTP cache and aborts every non-origin request",
      "Native shell, Tauri sidecar, real daemon, real profile and iOS are excluded",
    ],
    verdict: evaluateSoakPerformance(samples, minutes),
  };
  const output = path.join(artifactRoot, "soak.json");
  const save = () => {
    report.errorCounts = { pageErrors, consoleErrors, browserDiagnostics };
    report.verdict = evaluateSoakPerformance(samples, minutes, {
      pageErrors, consoleErrors, completed: report.completed,
      heapSnapshotMinutes: report.heapSnapshots.map(snapshot => snapshot.minute),
    });
    writeFileSync(output, JSON.stringify(report, null, 2));
  };
  const counters: Counters = { daemonPolls: 0, externalBlocked: 0, apiRequests: 0 };
  const context = await browser.newContext({ baseURL, extraHTTPHeaders, viewport: profile.viewport, serviceWorkers: "block" });
  let pageErrors = 0;
  let consoleErrors = 0;
  let browserDiagnostics = 0;
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
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // Browser-generated diagnostics (including the fixture's deliberate
      // 403s) have no JS arguments. Keep them separately; application calls to
      // console.error include React boundary failures and invalidate the run.
      if (message.args().length === 0) {
        browserDiagnostics += 1;
        if (report.browserErrorMessages.length < 20) report.browserErrorMessages.push(`${currentMode}: ${message.text().slice(0, 500)}`);
        return;
      }
      consoleErrors += 1;
      if (report.consoleErrorMessages.length < 20) report.consoleErrorMessages.push(`${currentMode}: ${message.text().slice(0, 500)}`);
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");
    await page.goto(profile.homeRoute);
    await expect(composerOf(page)).toBeEditable({ timeout: 60_000 });
    await expect.poll(() => counters.daemonPolls, { timeout: 30_000 }).toBeGreaterThan(0);
    // The document token proves every later sample was taken on this document:
    // an in-page mode switch keeps it, any reload or navigation loses it.
    const documentToken = `soak-${Date.now()}`;
    await page.evaluate((token) => { (window as unknown as { __soakDocument?: string }).__soakDocument = token; }, documentToken);
    const documentRetained = () => page.evaluate(() => (window as unknown as { __soakDocument?: string }).__soakDocument);
    const pid = listeningPid(port);
    report.server.pid = pid;
    const pageTitle = () => page.getByRole("heading", { level: 1, name: profile.modeTitles[currentMode as SoakMode | "home"], exact: true });
    const switchMode = async (mode: SoakMode | "home") => {
      currentMode = mode;
      await page.evaluate(([event, target]) => {
        window.dispatchEvent(new CustomEvent(event, { detail: { mode: target } }));
      }, [profile.navigateEvent, mode] as const);
      // The shell announces the mounted page; a closed room or a chunk that
      // failed to load never produces the mode's title. A surface may render
      // its own heading with the same title, so any match proves the mount.
      await expect(pageTitle().first()).toBeAttached({ timeout: 30_000 });
      if (mode === "journal") {
        // The shell heading survives a caught room crash. Prove the entry
        // pane rendered instead of counting the boundary fallback as a visit.
        await expect(page.getByRole("heading", { name: "Reflection", exact: true })).toBeVisible();
      }
      modeVisits[mode] = (modeVisits[mode] ?? 0) + 1;
    };
    const start = Date.now();
    const sample = async (index: number) => {
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? NaN;
      const tree = serverProcessTree(pid);
      samples.push({
        index, atMs: Date.now() - start, cycles, pageErrors, consoleErrors, externalBlocked: counters.externalBlocked,
        documentRetained: (await documentRetained()) === documentToken,
        server: { pid, ...tree, fdCount: serverFdCount(pid) },
        page: {
          jsHeapUsedBytes: metric("JSHeapUsedSize"), jsHeapTotalBytes: metric("JSHeapTotalSize"),
          domNodes: metric("Nodes"), jsEventListeners: metric("JSEventListeners"),
          documents: metric("Documents"), frames: metric("Frames"),
        },
        stateBytes: directoryBytes(stateRoot),
      });
      save();
      // Fixed snapshots attribute retained growth without changing the cycle,
      // sampling slots, GC policy or growth calculation.
      for (const minute of dueSoakHeapSnapshots(index, report.heapSnapshots.map(snapshot => snapshot.minute))) {
        const snapshotPath = path.join(artifactRoot, `minute-${minute}.heapsnapshot`);
        writeFileSync(snapshotPath, "");
        const chunk = ({ chunk }: { chunk: string }) => appendFileSync(snapshotPath, chunk);
        cdp.on("HeapProfiler.addHeapSnapshotChunk", chunk);
        try {
          await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
        } finally {
          cdp.off("HeapProfiler.addHeapSnapshotChunk", chunk);
        }
        report.heapSnapshots.push({ minute, sampleIndex: index, atMs: Date.now() - start, file: path.basename(snapshotPath) });
        save();
        console.log(`Heap snapshot: ${snapshotPath}`);
      }
    };
    // Slots are wall-clock positions from the start; a slot that passed while
    // a switch or a sample was running is recorded as missed, never clustered.
    const sampleDueSlot = async () => {
      const due = Math.floor((Date.now() - start) / profile.sampleIntervalMs);
      const taken = samples.length > 0 ? samples[samples.length - 1].index : -1;
      if (due > taken) await sample(due);
    };
    await sampleDueSlot();
    await page.screenshot({ path: path.join(artifactRoot, "first.png") });
    const deadline = start + minutes * 60_000;
    while (Date.now() < deadline) {
      for (const mode of profile.modes) {
        await switchMode(mode);
        await page.waitForTimeout(profile.dwellMs);
        await sampleDueSlot();
      }
      await switchMode("home");
      await expect(composerOf(page)).toBeEditable({ timeout: 60_000 });
      cycles += 1;
      await sampleDueSlot();
    }
    await switchMode("home");
    await expect(composerOf(page)).toBeEditable({ timeout: 60_000 });
    await sampleDueSlot();
    await page.screenshot({ path: path.join(artifactRoot, "last.png") });
    report.completed = true;
  } catch (error) {
    report.runError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await context.close().catch(() => {});
    save();
    await testInfo.attach("soak-measurements", { path: output, contentType: "application/json" });
  }
  expect(report.verdict.failures, JSON.stringify(report.verdict)).toEqual([]);
  expect(report.verdict.pass).toBe(true);
});
