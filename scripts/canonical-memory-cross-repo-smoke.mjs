#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";

import {
  classifyMemoryOpenProbe,
  isPathWithinRoot,
  parseStandaloneLaunchUrl,
} from "./canonical-memory-smoke-helpers.mjs";

const LOOPBACK = "127.0.0.1";
const FAMILIAR_ID = "fixture-familiar";
const FAMILIAR_NAME = "Fixture Familiar";
const CANONICAL_TITLE = "synthetic-alpha";
const FILE_MEMORY_NAME = "synthetic-file-note.md";
const MOBILE_ACCESS_SECRET = "canonical-memory-mobile-fixture";
const FIXED_MTIME = new Date("2026-07-26T09:56:00.000Z");
// Keep the socket path below macOS's short AF_UNIX sun_path ceiling. The root
// is still validated by realpath + exact parent + this unique mkdtemp prefix.
const TEMP_PREFIX = "ccm-";
const MAX_CAPTURE_BYTES = 128 * 1024;
const LIFECYCLE_TEST_MODE =
  process.env.COVEN_CANONICAL_MEMORY_SMOKE_TEST_MODE ?? "";
const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};
const managedChildren = new Set();
const managedBrowsers = new Set();
const childLifecycleRecords = new WeakMap();
const childTerminationPromises = new WeakMap();
const browserDisconnectRecords = new WeakMap();
const browserClosePromises = new WeakMap();
const shutdownController = new AbortController();

let activeStage = "bootstrap";
let validatedTempRoot = null;
let runtimeEnv = null;
let covenBin = null;
let daemonStopPromise = null;
let requestedSignal = null;
let shutdownInterruptPromise = null;
const upstreamBlockers = new Set();

class SmokeFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "SmokeFailure";
    this.code = code;
  }
}

function fail(code) {
  throw new SmokeFailure(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function report(key, value) {
  requireCondition(/^[a-z][a-z0-9_]*$/.test(key), "invalid_report_key");
  const rendered = String(value);
  requireCondition(/^[a-z0-9_-]+$/.test(rendered), "invalid_report_value");
  process.stdout.write(`${key}=${rendered}\n`);
}

function setStage(stage) {
  requireActive();
  activeStage = stage;
}

function boundedAppend(current, chunk) {
  const next = `${current}${String(chunk)}`;
  return next.length <= MAX_CAPTURE_BYTES
    ? next
    : next.slice(next.length - MAX_CAPTURE_BYTES);
}

function shutdownRequested() {
  return requestedSignal !== null;
}

function requireActive() {
  if (shutdownRequested()) fail("shutdown_requested");
}

function requireLaunchAllowed(options = {}) {
  if (options.cleanupLaunch !== true) requireActive();
}

function withClearedDeadline(operation, timeoutMs, timeoutCode) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      settle(value);
    };
    timer = setTimeout(
      () => finish(reject, new SmokeFailure(timeoutCode)),
      timeoutMs,
    );
    Promise.resolve(operation).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function trackChildLifecycle(child) {
  const existing = childLifecycleRecords.get(child);
  if (existing) return existing;

  let resolveSettlement;
  const record = {
    outcome: null,
    promise: new Promise((resolve) => {
      resolveSettlement = resolve;
    }),
  };
  const settle = (outcome) => {
    if (record.outcome !== null) return;
    record.outcome = outcome;
    managedChildren.delete(child);
    resolveSettlement(outcome);
  };
  child.once("error", () => {
    settle({ kind: "spawn_error", code: null, signal: null });
  });
  child.once("exit", (code, signal) => {
    settle({ kind: "exit", code, signal });
  });
  childLifecycleRecords.set(child, record);
  return record;
}

function childExit(child) {
  const tracked = childLifecycleRecords.get(child);
  if (tracked) return tracked.promise;
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      kind: "exit",
      code: child.exitCode,
      signal: child.signalCode,
    });
  }
  return trackChildLifecycle(child).promise;
}

function childOutcome(child) {
  return childLifecycleRecords.get(child)?.outcome ?? null;
}

function confirmChildSettlement(child, outcome) {
  requireCondition(
    outcome?.kind === "exit" || outcome?.kind === "spawn_error",
    "child_settlement_invalid",
  );
  managedChildren.delete(child);
}

function signalChild(child, signal) {
  if (
    childOutcome(child) !== null ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The child may have exited between the status check and the signal.
  }
}

function terminateChild(child) {
  if (!child) return Promise.resolve();
  if (childOutcome(child) !== null) {
    managedChildren.delete(child);
    return Promise.resolve();
  }
  const activeTermination = childTerminationPromises.get(child);
  if (activeTermination) return activeTermination;

  const termination = (async () => {
    const unconfirmedFixture =
      LIFECYCLE_TEST_MODE === "child-termination-unconfirmed";
    const gracefulWaitMs = unconfirmedFixture
      ? 100
      : shutdownRequested()
        ? 500
        : 3_000;
    const forcedWaitMs = unconfirmedFixture
      ? 150
      : shutdownRequested()
        ? 1_000
        : 3_000;
    signalChild(child, "SIGTERM");
    try {
      const outcome = await withClearedDeadline(
        childExit(child),
        gracefulWaitMs,
        "child_termination_grace_expired",
      );
      confirmChildSettlement(child, outcome);
      return;
    } catch (error) {
      if (
        !(error instanceof SmokeFailure) ||
        error.code !== "child_termination_grace_expired"
      ) {
        throw error;
      }
    }

    if (childOutcome(child) === null) {
      signalChild(child, "SIGKILL");
      const outcome = await withClearedDeadline(
        childExit(child),
        forcedWaitMs,
        "child_termination_unconfirmed",
      );
      confirmChildSettlement(child, outcome);
    }
  })().finally(() => childTerminationPromises.delete(child));
  childTerminationPromises.set(child, termination);
  return termination;
}

function launch(command, args, options = {}) {
  requireLaunchAllowed(options);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  managedChildren.add(child);
  const settlement = trackChildLifecycle(child).promise;

  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    output.stdout = boundedAppend(output.stdout, chunk);
    options.onStdout?.(String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr = boundedAppend(output.stderr, chunk);
  });
  return { child, output, settlement };
}

async function runResult(command, args, options = {}) {
  const { child, output, settlement } = launch(command, args, options);
  const timeoutMs = options.timeoutMs ?? 120_000;
  let timer;
  const result = await Promise.race([
    settlement,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (result.kind === "timeout") {
    await terminateChild(child);
    return { kind: "timeout", code: null, signal: null, ...output };
  }
  if (result.kind === "spawn_error") {
    fail(
      options.spawnFailureCode ??
        options.failureCode ??
        "child_process_spawn_failed",
    );
  }
  return {
    kind: "exit",
    code: result.code,
    signal: result.signal,
    ...output,
  };
}

async function runChecked(command, args, options = {}) {
  const result = await runResult(command, args, options);
  requireCondition(
    result.code === 0,
    options.failureCode ?? "child_process_failed",
  );
  return result;
}

function browserIsDisconnected(browser) {
  const record = browserDisconnectRecords.get(browser);
  if (record?.disconnected) return true;
  try {
    return (
      typeof browser?.isConnected === "function" &&
      browser.isConnected() === false
    );
  } catch {
    return false;
  }
}

function ensureBrowserDisconnectRecord(browser) {
  const existing = browserDisconnectRecords.get(browser);
  if (existing) return existing;

  let resolveDisconnected;
  const record = {
    disconnected: browserIsDisconnected(browser),
    promise: new Promise((resolve) => {
      resolveDisconnected = resolve;
    }),
  };
  const markDisconnected = () => {
    if (record.disconnected) return;
    record.disconnected = true;
    managedBrowsers.delete(browser);
    resolveDisconnected();
  };
  if (record.disconnected) {
    resolveDisconnected();
  } else {
    browser.once?.("disconnected", markDisconnected);
  }
  browserDisconnectRecords.set(browser, record);
  return record;
}

function registerManagedBrowser(browser) {
  ensureBrowserDisconnectRecord(browser);
  if (!browserIsDisconnected(browser)) managedBrowsers.add(browser);
  return browser;
}

function closeManagedBrowser(browser) {
  if (!browser) return Promise.resolve();
  if (browserIsDisconnected(browser)) {
    managedBrowsers.delete(browser);
    return Promise.resolve();
  }
  const activeClose = browserClosePromises.get(browser);
  if (activeClose) return activeClose;

  const disconnectRecord = ensureBrowserDisconnectRecord(browser);
  const closeAttempt = Promise.resolve().then(() => browser.close());
  closeAttempt.then(
    () => managedBrowsers.delete(browser),
    () => {
      if (browserIsDisconnected(browser)) managedBrowsers.delete(browser);
    },
  );
  const closeTimeoutMs =
    LIFECYCLE_TEST_MODE.endsWith("browser-close-timeout")
      ? 200
      : 5_000;
  const closing = withClearedDeadline(
    Promise.race([closeAttempt, disconnectRecord.promise]),
    closeTimeoutMs,
    "browser_close_timeout",
  )
    .then(() => {
      managedBrowsers.delete(browser);
    })
    .catch((error) => {
      if (browserIsDisconnected(browser)) {
        managedBrowsers.delete(browser);
        return;
      }
      if (error instanceof SmokeFailure) throw error;
      fail("browser_close_failed");
    })
    .finally(() => {
      browserClosePromises.delete(browser);
    });
  browserClosePromises.set(browser, closing);
  return closing;
}

async function launchManagedBrowser(
  options,
  launchImplementation = (launchOptions) =>
    chromium.launch(launchOptions),
) {
  requireLaunchAllowed();
  let browser;
  try {
    browser = await launchImplementation(options);
  } catch {
    if (shutdownRequested()) fail("shutdown_requested");
    fail("browser_launch_failed");
  }

  registerManagedBrowser(browser);
  if (shutdownRequested()) {
    try {
      await closeManagedBrowser(browser);
    } catch {
      fail("browser_shutdown_close_failed");
    }
    fail("shutdown_requested");
  }
  return browser;
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new SmokeFailure("port_reservation_failed"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitFor(predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (options.allowDuringShutdown !== true) requireActive();
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      if (error instanceof SmokeFailure || shutdownRequested()) throw error;
      // A process may not have bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  fail(options.failureCode ?? "wait_timed_out");
}

async function fetchWithShutdown(input, init = {}) {
  requireActive();
  const signal = init.signal
    ? AbortSignal.any([init.signal, shutdownController.signal])
    : shutdownController.signal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (shutdownRequested()) fail("shutdown_requested");
    throw error;
  }
}

async function waitForHttp(origin, child, failureCode) {
  return waitFor(
    async () => {
      if (
        childOutcome(child) !== null ||
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        fail(failureCode);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1_500);
      try {
        const response = await fetchWithShutdown(origin, {
          signal: controller.signal,
        });
        return response.status > 0;
      } finally {
        clearTimeout(timer);
      }
    },
    { timeoutMs: 120_000, failureCode },
  );
}

async function startHttpServer({
  command,
  args,
  cwd,
  envForPort,
  onStdout,
  failureCode,
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await reservePort();
    const origin = `http://${LOOPBACK}:${port}`;
    const launched = launch(command, args, {
      cwd,
      env: envForPort(port),
      onStdout,
    });
    try {
      await waitForHttp(origin, launched.child, failureCode);
      return { ...launched, origin, port };
    } catch (error) {
      const collision =
        launched.output.stderr.includes("EADDRINUSE") ||
        launched.output.stdout.includes("EADDRINUSE");
      await terminateChild(launched.child);
      if (!collision || attempt === 4) throw error;
    }
  }
  fail(failureCode);
}

async function jsonRequest(origin, pathname, init = {}) {
  const response = await fetchWithShutdown(`${origin}${pathname}`, init);
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function strictLocalReady(origin) {
  const { response, data } = await jsonRequest(origin, "/api/daemon/status");
  return (
    response.ok &&
    data?.running === true &&
    data?.target?.mode === "local"
  );
}

async function socketAcceptsConnections(socketPath) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1_000, () => finish(false));
  });
}

function hasPathKey(value) {
  if (Array.isArray(value)) return value.some(hasPathKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => key.toLowerCase() === "path" || hasPathKey(nested),
  );
}

function assertCanonicalPayloadSafe(value, tempRoot) {
  requireCondition(!hasPathKey(value), "canonical_payload_path_key");
  const serialized = JSON.stringify(value);
  requireCondition(
    !serialized.includes(tempRoot) &&
      !serialized.includes(encodeURIComponent(tempRoot)),
    "canonical_payload_temp_root",
  );
}

function normalizeEntries(entries) {
  return [...entries]
    .map(({ relativeUpdatedAt: _relativeUpdatedAt, ...entry }) => entry)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeOverview(overview) {
  return {
    ...overview,
    generatedAt: "<generated>",
    verification: {
      ...overview.verification,
      checkedAt: "<checked>",
    },
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJson(value[key])]),
  );
}

function deepEqual(left, right, code) {
  requireCondition(
    JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right)),
    code,
  );
}

async function validateRepo(candidate, markers, code) {
  let resolved;
  try {
    resolved = await realpath(path.resolve(candidate));
    for (const marker of markers) {
      await access(path.join(resolved, marker));
    }
  } catch {
    fail(code);
  }
  return resolved;
}

function findOpenCovenRoot(caveRepo) {
  let cursor = caveRepo;
  while (true) {
    if (path.basename(cursor) === "coven-cave") return path.dirname(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) fail("default_repo_root_unresolved");
    cursor = parent;
  }
}

async function createFixture(tempRoot) {
  const userHome = path.join(tempRoot, "h");
  const covenHome = path.join(userHome, ".coven");
  const caveHome = path.join(tempRoot, "cl");
  const hubCaveHome = path.join(tempRoot, "ch");
  // Current Coven binds this canonical basename; COVEN_SOCKET is still passed
  // explicitly to Cave and the standalone dashboard so all three agree.
  const socketPath = path.join(covenHome, "coven.sock");
  const canonicalDir = path.join(covenHome, "memory", FAMILIAR_ID);
  const workspace = path.join(
    covenHome,
    "workspaces",
    "familiars",
    FAMILIAR_ID,
  );
  const fileMemoryDir = path.join(workspace, "memory");

  await Promise.all([
    mkdir(canonicalDir, { recursive: true }),
    mkdir(fileMemoryDir, { recursive: true }),
    mkdir(caveHome, { recursive: true }),
    mkdir(hubCaveHome, { recursive: true }),
  ]);

  const canonicalFile = path.join(canonicalDir, `${CANONICAL_TITLE}.md`);
  const fileMemory = path.join(fileMemoryDir, FILE_MEMORY_NAME);
  await writeFile(
    canonicalFile,
    [
      "# Synthetic canonical memory",
      "",
      "CANONICAL-SYNTHETIC-MARKER",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    fileMemory,
    ["# Synthetic file memory", "", "FILE-SYNTHETIC-MARKER"].join("\n"),
    "utf8",
  );
  await Promise.all([
    utimes(canonicalFile, FIXED_MTIME, FIXED_MTIME),
    utimes(fileMemory, FIXED_MTIME, FIXED_MTIME),
  ]);

  const escapedWorkspace = workspace
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  await writeFile(
    path.join(covenHome, "familiars.toml"),
    [
      "[[familiar]]",
      `id = "${FAMILIAR_ID}"`,
      `display_name = "${FAMILIAR_NAME}"`,
      'role = "Synthetic archivist"',
      'description = "Deterministic cross-repository smoke fixture."',
      `workspace = "${escapedWorkspace}"`,
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(caveHome, "config.json"),
    JSON.stringify({
      version: 1,
      multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
    }),
    "utf8",
  );
  await writeFile(
    path.join(hubCaveHome, "config.json"),
    JSON.stringify({
      version: 1,
      multiHost: {
        mode: "hub",
        hubUrl: "http://127.0.0.1:9",
        executorUrls: [],
      },
    }),
    "utf8",
  );

  return {
    userHome,
    covenHome,
    caveHome,
    hubCaveHome,
    socketPath,
  };
}

function caveServerEnv(baseEnv, fixture, caveHome, port) {
  return {
    ...baseEnv,
    HOME: fixture.userHome,
    COVEN_HOME: fixture.covenHome,
    COVEN_CAVE_HOME: caveHome,
    COVEN_SOCKET: fixture.socketPath,
    COVEN_BIN: covenBin,
    COVEN_CAVE_ACCESS_TOKEN: MOBILE_ACCESS_SECRET,
    COVEN_CAVE_E2E: "1",
    COVEN_CAVE_HEAP_MONITOR: "0",
    HOSTNAME: LOOPBACK,
    PORT: String(port),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function stopIsolatedDaemon() {
  if (!covenBin || !runtimeEnv) return Promise.resolve();
  if (daemonStopPromise) return daemonStopPromise;

  const stopping = (async () => {
    await runResult(covenBin, ["daemon", "stop"], {
      env: runtimeEnv,
      timeoutMs: shutdownRequested() ? 5_000 : 20_000,
      cleanupLaunch: true,
    });
    await waitFor(
      async () => {
        try {
          await access(runtimeEnv.COVEN_SOCKET);
          return false;
        } catch {
          return true;
        }
      },
      {
        timeoutMs: shutdownRequested() ? 5_000 : 15_000,
        intervalMs: 150,
        failureCode: "daemon_socket_persisted",
        allowDuringShutdown: true,
      },
    );
  })().finally(() => {
    if (daemonStopPromise === stopping) daemonStopPromise = null;
  });
  daemonStopPromise = stopping;
  return stopping;
}

async function verifyCaveBrowser(origin, tempRoot) {
  const browser = await launchManagedBrowser({ headless: true });
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    let daemonStartCount = 0;
    const daemonStatuses = [];
    const canonicalCounts = { list: 0, overview: 0, detail: 0 };
    const canonicalReadiness = [];
    const browserPayloads = [];
    const detailIds = [];
    let routeFailure = null;
    let browserObservedLocalReady = false;

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "POST" &&
        url.pathname === "/api/daemon/start"
      ) {
        daemonStartCount += 1;
      }
    });

    await page.addInitScript(() => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {},
      });
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });

    await page.route("**/api/daemon/status", async (route) => {
      try {
        const response = await route.fetch();
        const payload = await response.json().catch(() => null);
        daemonStatuses.push({ status: response.status(), payload });
        if (
          response.status() === 200 &&
          payload?.running === true &&
          payload?.target?.mode === "local"
        ) {
          browserObservedLocalReady = true;
        }
        await route.fulfill({ response });
      } catch {
        routeFailure = "daemon_status_observer_failed";
        await route.abort().catch(() => {});
      }
    });

    await page.route("**/api/coven-memory**", async (route) => {
      try {
        const request = route.request();
        const url = new URL(request.url());
        if (
          request.method() !== "GET" ||
          (url.pathname !== "/api/coven-memory" &&
            !url.pathname.startsWith("/api/coven-memory/"))
        ) {
          await route.continue();
          return;
        }
        let kind;
        if (url.pathname === "/api/coven-memory") {
          kind = "list";
          canonicalCounts.list += 1;
        } else if (url.pathname === "/api/coven-memory/overview") {
          kind = "overview";
          canonicalCounts.overview += 1;
        } else {
          kind = "detail";
          canonicalCounts.detail += 1;
          detailIds.push(
            decodeURIComponent(url.pathname.slice("/api/coven-memory/".length)),
          );
        }
        // Record every background consumer, but require a successful list and
        // overview after the exact browser-visible readiness transition. Some
        // ornamental boot consumers may attempt a list while offline.
        canonicalReadiness.push({
          kind,
          ready: browserObservedLocalReady,
        });
        const response = await route.fetch();
        const payload = await response.json().catch(() => null);
        if (payload !== null) browserPayloads.push(payload);
        await route.fulfill({ response });
      } catch {
        routeFailure = "canonical_route_observer_failed";
        await route.abort().catch(() => {});
      }
    });

    await page.goto(origin, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.locator(".shell-frame").waitFor({
      state: "visible",
      timeout: 120_000,
    });
    const tauriInjected = await page.evaluate(
      () => "__TAURI_INTERNALS__" in window,
    );
    try {
      await waitFor(() => daemonStartCount === 1, {
        timeoutMs: 60_000,
        failureCode: "desktop_auto_start_missing",
      });
    } catch {
      if (!tauriInjected) fail("tauri_injection_missing");
      if (daemonStatuses.length === 0) fail("daemon_status_poll_missing");
      const firstStatus = daemonStatuses[0];
      if (
        firstStatus.status !== 200 ||
        firstStatus.payload?.running !== false ||
        firstStatus.payload?.availability !== "offline" ||
        firstStatus.payload?.target?.mode !== "local"
      ) {
        report("diagnostic_status_http", firstStatus.status);
        report(
          "diagnostic_status_running",
          typeof firstStatus.payload?.running === "boolean"
            ? String(firstStatus.payload.running)
            : "other",
        );
        report(
          "diagnostic_status_availability",
          typeof firstStatus.payload?.availability === "string"
            ? firstStatus.payload.availability
            : "other",
        );
        report(
          "diagnostic_status_target",
          typeof firstStatus.payload?.target?.mode === "string"
            ? firstStatus.payload.target.mode
            : "other",
        );
        fail("daemon_status_not_local_offline");
      }
      fail("desktop_auto_start_missing");
    }
    await waitFor(() => strictLocalReady(origin), {
      timeoutMs: 45_000,
      failureCode: "local_daemon_not_ready",
    });
    await waitFor(() => browserObservedLocalReady, {
      timeoutMs: 30_000,
      failureCode: "browser_local_readiness_missing",
    });

    await page.goto(`${origin}/?mode=agents`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.locator(".shell-frame").waitFor({
      state: "visible",
      timeout: 120_000,
    });
    await page
      .getByRole("button", { name: `Open ${FAMILIAR_NAME}` })
      .waitFor({ state: "visible", timeout: 120_000 });
    await page
      .getByRole("button", { name: `Open ${FAMILIAR_NAME}` })
      .click();
    await page
      .getByRole("button", { name: "Familiar memory", exact: true })
      .click();

    const dialog = page.getByRole("dialog", {
      name: `Memory for ${FAMILIAR_NAME}`,
    });
    await dialog.waitFor({ state: "visible", timeout: 60_000 });
    const canonicalRow = dialog
      .getByRole("button")
      .filter({ hasText: CANONICAL_TITLE })
      .first();
    await canonicalRow.waitFor({ state: "visible", timeout: 60_000 });
    await dialog
      .getByRole("button")
      .filter({ hasText: FILE_MEMORY_NAME })
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });

    requireCondition(routeFailure === null, routeFailure);
    requireCondition(daemonStartCount === 1, "desktop_auto_start_count");
    requireCondition(
      canonicalCounts.list >= 1 && canonicalCounts.overview >= 1,
      "canonical_boot_reads_missing",
    );
    requireCondition(
      canonicalReadiness.some(
        (request) => request.kind === "list" && request.ready,
      ) &&
        canonicalReadiness.some(
          (request) => request.kind === "overview" && request.ready,
        ),
      "canonical_post_ready_reads_missing",
    );
    requireCondition(
      canonicalCounts.detail === 0,
      "canonical_detail_not_lazy",
    );

    const listPayload = browserPayloads.find(
      (payload) => Array.isArray(payload?.entries),
    );
    requireCondition(listPayload?.entries?.length === 1, "browser_list_shape");
    const selectedId = listPayload.entries[0].id;
    requireCondition(
      typeof selectedId === "string" && selectedId.length > 0,
      "browser_opaque_id_missing",
    );

    await canonicalRow.click();
    await waitFor(() => canonicalCounts.detail === 1, {
      timeoutMs: 30_000,
      failureCode: "canonical_detail_selection_missing",
    });
    await dialog.locator("article").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    requireCondition(
      canonicalCounts.detail === 1 &&
        detailIds.length === 1 &&
        detailIds[0] === selectedId,
      "canonical_detail_selection_count",
    );

    await waitFor(
      () =>
        browserPayloads.some(
          (payload) => payload?.entry?.id === selectedId,
        ),
      {
        timeoutMs: 10_000,
        failureCode: "browser_detail_payload_missing",
      },
    );
    for (const payload of browserPayloads) {
      assertCanonicalPayloadSafe(payload, tempRoot);
    }

    report("daemon_auto_start_count", daemonStartCount);
    report("browser_canonical_list_count", canonicalCounts.list);
    report("browser_canonical_overview_count", canonicalCounts.overview);
    report("browser_canonical_detail_count", canonicalCounts.detail);
    report("browser_status", "ok");

    return { selectedId, browserPayloads };
  } finally {
    await closeManagedBrowser(browser);
  }
}

async function verifyCaveApi(origin, selectedId, tempRoot) {
  const [list, overview, detail] = await Promise.all([
    jsonRequest(origin, "/api/coven-memory"),
    jsonRequest(origin, "/api/coven-memory/overview"),
    jsonRequest(origin, `/api/coven-memory/${encodeURIComponent(selectedId)}`),
  ]);
  for (const result of [list, overview, detail]) {
    requireCondition(result.response.status === 200, "cave_canonical_get_status");
    assertCanonicalPayloadSafe(result.data, tempRoot);
  }

  let post405Count = 0;
  for (const pathname of [
    "/api/coven-memory",
    "/api/coven-memory/overview",
    `/api/coven-memory/${encodeURIComponent(selectedId)}`,
  ]) {
    const response = await fetchWithShutdown(`${origin}${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: "{}",
    });
    requireCondition(response.status === 405, "canonical_post_status");
    requireCondition(
      (response.headers.get("allow") ?? "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .includes("GET"),
      "canonical_post_allow_header",
    );
    post405Count += 1;
  }

  report("canonical_post_405_count", post405Count);
  report("cave_api_status", "ok");
  return {
    entries: list.data.entries,
    overview: overview.data.overview,
    entry: detail.data.entry,
  };
}

async function verifyMobileBoundary(origin) {
  const { response, data } = await jsonRequest(
    origin,
    "/api/coven-memory",
    {
      headers: {
        authorization: `Bearer ${MOBILE_ACCESS_SECRET}`,
        // Native paired clients do not send a browser Origin. The forwarding
        // markers keep this off the trusted-local-peer path; the bearer lets
        // proxy.ts authenticate it and stamp mobile ingress for the route.
        "x-forwarded-for": "100.64.0.2",
        "x-forwarded-host": "cave.example.ts.net",
        "x-forwarded-proto": "https",
      },
    },
  );
  requireCondition(
    response.status === 403 && data?.code === "local_access_required",
    "mobile_boundary_status",
  );
  report("mobile_boundary_status", "ok");
}

async function startStandalone(memoryRepo, fixture) {
  const server = await startHttpServer({
    command: "pnpm",
    args: ["start"],
    cwd: memoryRepo,
    envForPort: (port) => ({
      ...process.env,
      HOME: fixture.userHome,
      COVEN_HOME: fixture.covenHome,
      COVEN_DAEMON_SOCKET: fixture.socketPath,
      HOST: LOOPBACK,
      PORT: String(port),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    }),
    failureCode: "standalone_start_failed",
  });
  const launchUrl = await waitFor(
    () => {
      try {
        return parseStandaloneLaunchUrl(server.output.stdout);
      } catch {
        fail("standalone_launch_url_invalid");
      }
    },
    {
      timeoutMs: 30_000,
      failureCode: "standalone_launch_url_missing",
    },
  );
  requireCondition(
    launchUrl.origin === server.origin,
    "standalone_launch_origin_mismatch",
  );
  return { ...server, launchUrl };
}

async function verifyStandalone(
  server,
  selectedId,
  cavePayloads,
  caveOrigin,
  socketPath,
) {
  const document = await fetchWithShutdown(server.launchUrl);
  requireCondition(
    document.status === 200 &&
      document.headers.get("set-cookie") === null,
    "standalone_local_transport_status",
  );
  report("standalone_local_transport_status", "ok");

  const standaloneFetch = (pathname) =>
    jsonRequest(server.origin, pathname, {
      headers: { origin: server.origin },
    });
  const list = await standaloneFetch("/api/memory");
  const standaloneListCode =
    typeof list.data?.code === "string" &&
    /^[a-z0-9_-]+$/.test(list.data.code)
      ? list.data.code
      : "none";
  report("standalone_list_http_status", list.response.status);
  report("standalone_list_code", standaloneListCode);
  const knownContractBlocker =
    (list.response.status === 502 &&
      list.data?.code === "invalid_daemon_payload") ||
    (list.response.status === 503 &&
      list.data?.code === "memory_unavailable");
  if (knownContractBlocker) {
    const [socketReady, caveList] = await Promise.all([
      socketAcceptsConnections(socketPath),
      jsonRequest(caveOrigin, "/api/coven-memory"),
    ]);
    requireCondition(
      socketReady &&
        caveList.response.status === 200 &&
        caveList.data?.ok === true,
      "standalone_contract_daemon_probe",
    );
    report("standalone_daemon_probe_status", "ok");
    upstreamBlockers.add("standalone_contract");
    report("standalone_contract_status", "blocked");
    report("cross_repo_comparison_status", "blocked");
    return;
  }
  requireCondition(list.response.status === 200, "standalone_list_status");
  const [overview, detail] = await Promise.all([
    standaloneFetch("/api/memory/overview"),
    standaloneFetch(`/api/memory/${encodeURIComponent(selectedId)}`),
  ]);
  requireCondition(
    overview.response.status === 200 && detail.response.status === 200,
    "standalone_read_status",
  );

  deepEqual(
    normalizeEntries(cavePayloads.entries),
    normalizeEntries(list.data.data),
    "cross_repo_list_mismatch",
  );
  deepEqual(
    normalizeOverview(cavePayloads.overview),
    normalizeOverview(overview.data.data),
    "cross_repo_overview_mismatch",
  );
  deepEqual(
    cavePayloads.entry,
    detail.data.data,
    "cross_repo_detail_mismatch",
  );
  report("standalone_contract_status", "ok");
  report("cross_repo_comparison_status", "ok");
}

async function verifyDaemonStoppedBehavior(origin, fixture) {
  const canonical = await jsonRequest(origin, "/api/coven-memory");
  requireCondition(
    canonical.response.status === 503 &&
      canonical.data?.code === "canonical_memory_unavailable",
    "canonical_offline_status",
  );
  const files = await jsonRequest(
    origin,
    `/api/memory?familiarId=${encodeURIComponent(FAMILIAR_ID)}`,
  );
  requireCondition(
    files.response.status === 200 &&
      files.data?.ok === true &&
      files.data.entries?.some(
        (entry) =>
          entry.familiarId === FAMILIAR_ID &&
          entry.relPath === FILE_MEMORY_NAME,
      ),
    "file_memory_missing_while_daemon_stopped",
  );
  requireCondition(
    files.data.entries.every((entry) =>
      isPathWithinRoot(fixture.userHome, entry.fullPath),
    ),
    "file_memory_home_escape",
  );
  report("daemon_stopped_boundary_status", "ok");
  report("file_memory_survival_count", 1);
}

async function verifyHubBoundary(caveRepo, fixture) {
  const server = await startHttpServer({
    command: process.execPath,
    args: ["server.mjs"],
    cwd: caveRepo,
    envForPort: (port) =>
      caveServerEnv(process.env, fixture, fixture.hubCaveHome, port),
    failureCode: "hub_cave_start_failed",
  });
  try {
    const { response, data } = await jsonRequest(
      server.origin,
      "/api/coven-memory",
    );
    requireCondition(
      response.status === 409 && data?.code === "local_daemon_required",
      "hub_boundary_status",
    );
    report("hub_boundary_status", "ok");
  } finally {
    await terminateChild(server.child);
  }
}

async function cleanupTempRoot() {
  if (!validatedTempRoot) return;
  const tempParent = await realpath(os.tmpdir());
  let actualRoot;
  try {
    actualRoot = await realpath(validatedTempRoot);
  } catch {
    return;
  }
  requireCondition(
    actualRoot === validatedTempRoot &&
      path.dirname(actualRoot) === tempParent &&
      path.basename(actualRoot).startsWith(TEMP_PREFIX),
    "temp_cleanup_guard",
  );
  await rm(actualRoot, { recursive: true, force: true });
}

async function createGuardedTempRoot() {
  requireActive();
  const tempParent = await realpath(os.tmpdir());
  const tempRoot = await realpath(
    await mkdtemp(path.join(tempParent, TEMP_PREFIX)),
  );
  validatedTempRoot = tempRoot;
  requireCondition(
    path.dirname(tempRoot) === tempParent &&
      path.basename(tempRoot).startsWith(TEMP_PREFIX),
    "temp_root_validation",
  );
  requireActive();
  return tempRoot;
}

async function interruptOwnedResources() {
  const results = await Promise.allSettled([
    ...[...managedChildren].map((child) => terminateChild(child)),
    ...[...managedBrowsers].map((browser) =>
      closeManagedBrowser(browser),
    ),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    fail("resource_interrupt_failed");
  }
}

async function cleanupOwnedResources() {
  let cleanupFailed = false;
  const attemptRequiredCleanup = async (operation) => {
    try {
      await operation();
    } catch {
      cleanupFailed = true;
    }
  };
  const attemptResourceDrain = async () => {
    try {
      await interruptOwnedResources();
    } catch {
      // Final ownership state below decides whether deleting the root is safe.
    }
  };

  if (shutdownInterruptPromise) {
    try {
      await shutdownInterruptPromise;
    } catch {
      // Retry every still-owned resource below.
    }
  }
  await attemptResourceDrain();
  await attemptRequiredCleanup(stopIsolatedDaemon);
  await attemptResourceDrain();

  const ownedResourcesRemain =
    managedChildren.size > 0 || managedBrowsers.size > 0;
  if (ownedResourcesRemain) cleanupFailed = true;
  if (!cleanupFailed) {
    await attemptRequiredCleanup(cleanupTempRoot);
  }

  if (LIFECYCLE_TEST_MODE === "cleanup-failure") {
    cleanupFailed = true;
  }
  if (cleanupFailed) fail("cleanup_failed");
}

function emitFinalOutcome(outcome) {
  if (outcome.kind === "ok") {
    report("blocker_count", 0);
    report("smoke_status", "ok");
    return 0;
  }
  if (outcome.kind === "blocked") {
    report("blocker_count", outcome.blockerCount);
    report("smoke_status", "blocked");
    report("failure_stage", "aggregate_results");
    report("failure_code", "upstream_blockers");
    return 1;
  }
  if (outcome.kind === "signal") {
    report("failure_stage", "signal_cleanup");
    report("failure_code", outcome.signal.toLowerCase());
    report("smoke_status", "failed");
    return SIGNAL_EXIT_CODES[outcome.signal];
  }
  report("failure_stage", outcome.stage);
  report("failure_code", outcome.code);
  report("smoke_status", "failed");
  return 1;
}

let finalizationPromise = null;

function finalizeOnce(outcome) {
  if (!finalizationPromise) {
    finalizationPromise = (async () => {
      try {
        await cleanupOwnedResources();
      } catch {
        report("failure_stage", "cleanup");
        report("failure_code", "cleanup_failed");
        report("smoke_status", "failed");
        return 1;
      }
      const finalOutcome = requestedSignal
        ? { kind: "signal", signal: requestedSignal }
        : outcome;
      return emitFinalOutcome(finalOutcome);
    })();
  }
  return finalizationPromise;
}

function installSignalCleanup() {
  for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
    process.on(signal, () => {
      if (requestedSignal !== null) return;
      requestedSignal = signal;
      shutdownController.abort();
      shutdownInterruptPromise = interruptOwnedResources();
      void shutdownInterruptPromise.catch(() => {});
      if (LIFECYCLE_TEST_MODE === "signal") {
        report("lifecycle_signal_requested", "ok");
      }
    });
  }
}

async function runLifecycleTestFixture(mode) {
  setStage("lifecycle_fixture");
  validatedTempRoot = await createGuardedTempRoot();
  if (mode === "cleanup-failure") {
    report("lifecycle_fixture_ready", "ok");
    return { kind: "ok" };
  }
  if (
    mode === "late-browser-close-reject" ||
    mode === "late-browser-close-timeout"
  ) {
    let resolveLateBrowser;
    const lateBrowser = {
      close() {
        return mode === "late-browser-close-reject"
          ? Promise.reject(new Error("private late browser close detail"))
          : new Promise(() => {});
      },
      isConnected() {
        return true;
      },
    };
    const launchOutcome = launchManagedBrowser(
      {},
      () =>
        new Promise((resolve) => {
          resolveLateBrowser = resolve;
        }),
    ).then(
      () => "opened",
      (error) =>
        error instanceof SmokeFailure ? error.code : "unexpected_failure",
    );
    await writeFile(
      path.join(validatedTempRoot, "late-browser-ready"),
      "ready",
      "utf8",
    );
    const fixtureKeepAlive = setInterval(() => {}, 1_000);
    try {
      await new Promise((resolve) => {
        if (shutdownController.signal.aborted) {
          resolve();
          return;
        }
        shutdownController.signal.addEventListener("abort", resolve, {
          once: true,
        });
      });
    } finally {
      clearInterval(fixtureKeepAlive);
    }
    resolveLateBrowser(lateBrowser);
    requireCondition(
      (await launchOutcome) === "browser_shutdown_close_failed",
      "fixture_late_browser_close_not_failed",
    );
    return { kind: "ok" };
  }
  if (mode === "browser-close-reject") {
    registerManagedBrowser({
      close() {
        return Promise.reject(new Error("private browser close detail"));
      },
      isConnected() {
        return true;
      },
    });
    return { kind: "ok" };
  }
  if (mode === "browser-close-timeout") {
    registerManagedBrowser({
      close() {
        return new Promise(() => {});
      },
      isConnected() {
        return true;
      },
    });
    return { kind: "ok" };
  }
  if (mode === "child-termination-unconfirmed") {
    const childAnalogue = {
      exitCode: null,
      signalCode: null,
      pid: null,
      kill() {
        return true;
      },
      once() {},
    };
    managedChildren.add(childAnalogue);
    trackChildLifecycle(childAnalogue);
    return { kind: "ok" };
  }
  if (mode === "spawn-error") {
    const missingExecutable =
      process.env.COVEN_CANONICAL_MEMORY_SMOKE_TEST_EXECUTABLE;
    requireCondition(
      typeof missingExecutable === "string" &&
        missingExecutable.length > 0,
      "fixture_executable_missing",
    );
    try {
      await access(missingExecutable);
      fail("fixture_executable_present");
    } catch (error) {
      if (error instanceof SmokeFailure || error?.code !== "ENOENT") {
        throw error;
      }
    }
    await runChecked(missingExecutable, [], {
      cwd: validatedTempRoot,
      env: {
        HOME: path.join(validatedTempRoot, "h"),
        TMPDIR: validatedTempRoot,
      },
      timeoutMs: 2_000,
      failureCode: "fixture_spawn_failed",
    });
    fail("fixture_spawn_succeeded");
  }
  if (mode !== "signal") fail("invalid_lifecycle_test_mode");

  const syntheticHome = path.join(validatedTempRoot, "h");
  await mkdir(syntheticHome, { recursive: true });
  let ownedBrowserClosed = false;
  const ownedBrowser = {
    async close() {
      ownedBrowserClosed = true;
    },
  };
  registerManagedBrowser(ownedBrowser);

  let resolveLateBrowser;
  let lateBrowserClosed = false;
  const lateBrowser = {
    async close() {
      lateBrowserClosed = true;
    },
  };
  const lateBrowserOutcome = launchManagedBrowser(
    {},
    () =>
      new Promise((resolve) => {
        resolveLateBrowser = resolve;
      }),
  ).then(
    () => "opened",
    (error) =>
      error instanceof SmokeFailure ? error.code : "unexpected_failure",
  );

  const { child } = launch(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    ],
    {
      cwd: validatedTempRoot,
      env: {
        HOME: syntheticHome,
        TMPDIR: validatedTempRoot,
      },
    },
  );
  await writeFile(
    path.join(validatedTempRoot, "fixture-child.pid"),
    String(child.pid),
    "utf8",
  );
  report("lifecycle_fixture_ready", "ok");
  try {
    await new Promise((resolve) => {
      if (shutdownController.signal.aborted) {
        resolve();
        return;
      }
      shutdownController.signal.addEventListener("abort", resolve, {
        once: true,
      });
    });

    let lateLaunchRejected = false;
    try {
      launch(process.execPath, ["-e", "process.exit(0)"], {
        cwd: validatedTempRoot,
      });
    } catch (error) {
      lateLaunchRejected =
        error instanceof SmokeFailure &&
        error.code === "shutdown_requested";
    }
    requireCondition(
      lateLaunchRejected,
      "fixture_late_launch_not_rejected",
    );
    report("lifecycle_late_launch_rejected", "ok");

    resolveLateBrowser(lateBrowser);
    requireCondition(
      (await lateBrowserOutcome) === "shutdown_requested" &&
        lateBrowserClosed,
      "fixture_late_browser_not_closed",
    );
    report("lifecycle_late_browser_closed", "ok");

    await shutdownInterruptPromise;
    requireCondition(
      ownedBrowserClosed && !managedBrowsers.has(ownedBrowser),
      "fixture_owned_browser_not_closed",
    );
    report("lifecycle_owned_browser_closed", "ok");

    const childResult = await childExit(child);
    requireCondition(
      childResult.kind === "exit" &&
        (childResult.code !== null || childResult.signal !== null),
      "fixture_owned_child_not_closed",
    );
    report("lifecycle_owned_child_closed", "ok");
  } finally {
    await access(validatedTempRoot);
    report("lifecycle_root_present_during_unwind", "ok");
    report("lifecycle_fixture_unwound", "ok");
  }
  return { kind: "ok" };
}

async function main() {
  setStage("resolve_repositories");
  const caveRepo = await validateRepo(
    process.cwd(),
    ["package.json", "server.ts"],
    "cave_repo_invalid",
  );
  const openCovenRoot = findOpenCovenRoot(caveRepo);
  const covenRepo = await validateRepo(
    process.env.COVEN_REPO ?? path.join(openCovenRoot, "coven"),
    ["Cargo.toml", "crates/coven-cli/Cargo.toml"],
    "coven_repo_invalid",
  );
  const memoryRepo = await validateRepo(
    process.env.COVEN_MEMORY_REPO ??
      path.join(openCovenRoot, "coven-memory"),
    ["package.json", "server.ts", "src/server/memory-gateway.ts"],
    "memory_repo_invalid",
  );

  setStage("create_temp_fixture");
  validatedTempRoot = await createGuardedTempRoot();
  const fixture = await createFixture(validatedTempRoot);
  report("fixture_status", "ok");

  setStage("build_coven");
  await runChecked("cargo", ["build", "-p", "coven-cli"], {
    cwd: covenRepo,
    env: process.env,
    timeoutMs: 900_000,
    failureCode: "coven_build_failed",
  });
  covenBin = path.join(
    covenRepo,
    "target",
    "debug",
    process.platform === "win32" ? "coven.exe" : "coven",
  );
  await access(covenBin).catch(() => fail("coven_binary_missing"));
  runtimeEnv = {
    ...process.env,
    HOME: fixture.userHome,
    COVEN_HOME: fixture.covenHome,
    COVEN_SOCKET: fixture.socketPath,
  };
  report("coven_build_status", "ok");

  setStage("probe_cli_memory_open");
  const memoryOpen = await runResult(
    covenBin,
    ["memory", "open", "--help"],
    {
      env: runtimeEnv,
      timeoutMs: 20_000,
      spawnFailureCode: "cli_memory_open_probe_failed",
    },
  );
  const memoryOpenClassification = classifyMemoryOpenProbe(memoryOpen);
  if (memoryOpenClassification === "available") {
    report("cli_memory_open_status", "ok");
  } else if (memoryOpenClassification === "missing") {
    upstreamBlockers.add("cli_memory_open");
    report("cli_memory_open_status", "missing");
  } else {
    fail("cli_memory_open_probe_failed");
  }

  setStage("build_cave");
  await runChecked("pnpm", ["build"], {
    cwd: caveRepo,
    env: {
      ...process.env,
      HOME: fixture.userHome,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    timeoutMs: 900_000,
    failureCode: "cave_build_failed",
  });
  await access(path.join(caveRepo, "server.mjs")).catch(() =>
    fail("cave_server_bundle_missing"),
  );
  report("cave_build_status", "ok");

  setStage("initial_daemon_stop");
  await stopIsolatedDaemon();
  await unlink(fixture.socketPath).catch((error) => {
    if (error?.code !== "ENOENT") fail("initial_socket_cleanup_failed");
  });
  requireCondition(
    !(await socketAcceptsConnections(fixture.socketPath)),
    "daemon_initially_running",
  );
  report("daemon_initial_status", "stopped");

  setStage("start_local_cave");
  const caveServer = await startHttpServer({
    command: process.execPath,
    args: ["server.mjs"],
    cwd: caveRepo,
    envForPort: (port) =>
      caveServerEnv(process.env, fixture, fixture.caveHome, port),
    failureCode: "local_cave_start_failed",
  });
  try {
    setStage("verify_cave_browser");
    const browserResult = await verifyCaveBrowser(
      caveServer.origin,
      validatedTempRoot,
    );

    setStage("verify_cave_api");
    const cavePayloads = await verifyCaveApi(
      caveServer.origin,
      browserResult.selectedId,
      validatedTempRoot,
    );

    setStage("verify_mobile_boundary");
    await verifyMobileBoundary(caveServer.origin);

    setStage("build_standalone");
    await runChecked("pnpm", ["build"], {
      cwd: memoryRepo,
      env: {
        ...process.env,
        HOME: fixture.userHome,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      timeoutMs: 900_000,
      failureCode: "standalone_build_failed",
    });
    report("standalone_build_status", "ok");

    setStage("verify_standalone");
    const standalone = await startStandalone(memoryRepo, fixture);
    try {
      await verifyStandalone(
        standalone,
        browserResult.selectedId,
        cavePayloads,
        caveServer.origin,
        fixture.socketPath,
      );
    } finally {
      await terminateChild(standalone.child);
    }

    setStage("stop_daemon");
    await stopIsolatedDaemon();
    await verifyDaemonStoppedBehavior(caveServer.origin, fixture);
  } finally {
    await terminateChild(caveServer.child);
  }

  setStage("verify_hub_boundary");
  await verifyHubBoundary(caveRepo, fixture);

  setStage("aggregate_results");
  if (upstreamBlockers.size > 0) {
    return {
      kind: "blocked",
      blockerCount: upstreamBlockers.size,
    };
  }
  return { kind: "ok" };
}

installSignalCleanup();

let outcome;
try {
  outcome =
    LIFECYCLE_TEST_MODE === "signal" ||
    LIFECYCLE_TEST_MODE === "cleanup-failure" ||
    LIFECYCLE_TEST_MODE === "late-browser-close-reject" ||
    LIFECYCLE_TEST_MODE === "late-browser-close-timeout" ||
    LIFECYCLE_TEST_MODE === "browser-close-reject" ||
    LIFECYCLE_TEST_MODE === "browser-close-timeout" ||
    LIFECYCLE_TEST_MODE === "child-termination-unconfirmed" ||
    LIFECYCLE_TEST_MODE === "spawn-error"
      ? await runLifecycleTestFixture(LIFECYCLE_TEST_MODE)
      : await main();
} catch (error) {
  const code =
    error instanceof SmokeFailure ? error.code : "unexpected_failure";
  outcome = {
    kind: "failed",
    stage: activeStage,
    code,
  };
}

process.exitCode = await finalizeOnce(outcome);
