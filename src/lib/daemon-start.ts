import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { promisify } from "node:util";
import { callDaemonTarget, localDaemonTarget, socketPath } from "./coven-daemon.ts";
import { covenLaunchCommand } from "./coven-bin.ts";
import { covenCliMissingError, isMissingExecutableError } from "./coven-spawn-error.ts";
import { harnessSpawnEnv } from "./harness-spawn-env.ts";
import { waitForDaemonReadiness } from "./daemon-readiness.ts";
import { sanitizeAboutDiagnosticText } from "./about-diagnostics.ts";
import { installedCovenVersion } from "./coven-version.ts";
import {
  assessDaemonStartupCompatibility,
  type DaemonStartupCompatibility,
  type DaemonStartupHealth,
} from "./daemon-startup-contract.ts";
import { RuntimeStartupCoordinator } from "./runtime-startup-throttle.ts";
import {
  inspectDaemonAddress,
  reportsDaemonAddressInUse,
  type DaemonAddressOccupancy,
} from "./daemon-socket-occupancy.ts";
import {
  createDaemonDiagnosticContext,
  diagnosticError,
  recordDaemonDiagnosticEvent,
  type DaemonDiagnosticContext,
} from "./server/daemon-diagnostics.ts";

export type DaemonStartResult =
  | { ok: true; alreadyRunning: true; readinessAttempts: number; elapsedMs: number; launchMode: "none" }
  | {
    ok: true;
    alreadyRunning: false;
    readinessAttempts: number;
    elapsedMs: number;
    launchMode: "shell" | "direct";
    runner: "still-running" | "exited";
    stdout: string;
    stderr: string;
  }
  | {
    ok: false;
    code:
      | "spawn_failed"
      | "runner_exited"
      | "readiness_timeout"
      | "runtime_incompatible"
      | "restart_throttled"
      | "owner_unreachable"
      | "address_in_use";
    error: string;
    stdout: string;
    stderr: string;
    status: 409 | 429 | 500 | 504;
    readinessAttempts: number;
    elapsedMs: number;
    launchMode: "none" | "shell" | "direct";
    exitCode?: number | null;
    /** Present only when Cave owned a launch that failed its readiness window. */
    cleanup?: DaemonLaunchCleanup;
  };

/**
 * A failed daemon launch must not leave a retry-blocking process tree behind.
 * Deliberately omit PIDs and command lines: this crosses the API boundary.
 */
export type DaemonLaunchCleanup = {
  attempted: boolean;
  completed: boolean;
  mode: "windows-tree" | "process-group" | "child";
};

type DaemonLaunchCleanupDependencies = {
  platform?: NodeJS.Platform;
  terminateWindowsTree?: (pid: number) => Promise<boolean>;
  killProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
  waitForExit?: (child: ChildProcess, timeoutMs: number) => Promise<boolean>;
  processGroupAlive?: (pid: number) => boolean;
  waitForProcessGroupExit?: (pid: number, timeoutMs: number) => Promise<boolean>;
};

const execFileAsync = promisify(execFile);

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childExited(child)) return true;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("close", onClose);
      child.off("error", onClose);
      resolve(value);
    };
    const onClose = () => settle(true);
    const timeout = setTimeout(() => settle(childExited(child)), timeoutMs);
    child.once("close", onClose);
    child.once("error", onClose);
  });
}

async function terminateWindowsTree(pid: number): Promise<boolean> {
  try {
    await execFileAsync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      timeout: 2_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function terminateChild(child: ChildProcess, waitForExit: (child: ChildProcess, timeoutMs: number) => Promise<boolean>) {
  try {
    child.kill("SIGTERM");
  } catch {
    return false;
  }
  return waitForExit(child, 2_000);
}

function isMissingProcess(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcess(error);
  }
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !processGroupAlive(pid);
}

/**
 * Terminates only the process tree Cave started after readiness has failed a
 * final health check. Windows taskkill owns the shell and all descendants;
 * POSIX launches use an isolated process group so a foreground shell cannot
 * strand its daemon child. This is intentionally not used for a healthy
 * daemon, even if its launcher is still foregrounded.
 */
export async function terminateDaemonLaunchTree(
  child: ChildProcess,
  dependencies: DaemonLaunchCleanupDependencies = {},
): Promise<DaemonLaunchCleanup> {
  const platform = dependencies.platform ?? process.platform;
  const waitForExit = dependencies.waitForExit ?? waitForChildExit;
  const groupAlive = dependencies.processGroupAlive ?? processGroupAlive;
  const waitForGroupExit = dependencies.waitForProcessGroupExit ?? waitForProcessGroupExit;
  const pid = child.pid;

  if (platform === "win32") {
    const completed = pid === undefined
      ? await terminateChild(child, waitForExit)
      : await (dependencies.terminateWindowsTree ?? terminateWindowsTree)(pid);
    return { attempted: true, completed, mode: pid === undefined ? "child" : "windows-tree" };
  }

  if (pid === undefined) {
    return { attempted: true, completed: await terminateChild(child, waitForExit), mode: "child" };
  }

  const killProcessGroup = dependencies.killProcessGroup ?? ((groupPid, signal) => process.kill(-groupPid, signal));
  try {
    killProcessGroup(pid, "SIGTERM");
  } catch (error) {
    // A process that disappeared between readiness and cleanup is already
    // safe. Other failures are reported as incomplete cleanup diagnostics.
    if (isMissingProcess(error)) {
      return { attempted: true, completed: true, mode: "process-group" };
    }
    return { attempted: true, completed: false, mode: "process-group" };
  }
  await waitForExit(child, 500);
  if (!groupAlive(pid)) {
    return { attempted: true, completed: true, mode: "process-group" };
  }
  try {
    killProcessGroup(pid, "SIGKILL");
  } catch (error) {
    if (!isMissingProcess(error)) {
      return { attempted: true, completed: false, mode: "process-group" };
    }
  }
  return {
    attempted: true,
    completed: await waitForGroupExit(pid, 500),
    mode: "process-group",
  };
}

type StartLocalDaemonOptions = {
  restart?: boolean;
  /** Automatic recovery fails closed when another lifecycle owner is possible. */
  automatic?: boolean;
  healthTimeoutMs?: number;
  startTimeoutMs?: number;
  readinessPollMs?: number;
  /** Test seams keep launch ownership and timeout cleanup executable. */
  probe?: () => Promise<{ ok: boolean }>;
  /** Injectable health document that still exercises compatibility assessment. */
  readHealthDocument?: () => Promise<DaemonStartupHealth | null>;
  /** Injectable installed-version seam for deterministic startup coherence tests. */
  installedVersion?: () => Promise<string | null>;
  /** Injectable address-occupancy seam for deterministic already-bound tests. */
  inspectAddress?: () => Promise<DaemonAddressOccupancy>;
  /** Injectable command seam keeps fault scenarios independent of host PATH state. */
  launchCommand?: () => { command: string; args: string[]; shell?: boolean };
  /** Injectable environment seam keeps fault scenarios independent of credential stores. */
  spawnEnvironment?: () => NodeJS.ProcessEnv;
  spawnImpl?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  terminateLaunchTree?: (child: ChildProcess) => Promise<DaemonLaunchCleanup>;
  inspectLifecycle?: () => Promise<DaemonLifecycleInspection>;
  platform?: NodeJS.Platform;
  diagnostics?: DaemonDiagnosticContext;
};

export type DaemonLifecycleInspection = {
  status: "running" | "stopped" | "stale" | "unknown";
};

export function parseDaemonLifecycleInspection(value: unknown): DaemonLifecycleInspection {
  if (!value || typeof value !== "object" || !("status" in value)) {
    return { status: "unknown" };
  }
  const status = value.status;
  return status === "running" || status === "stopped" || status === "stale"
    ? { status }
    : { status: "unknown" };
}

async function inspectDaemonLifecycle(
  diagnostics?: DaemonDiagnosticContext,
): Promise<DaemonLifecycleInspection> {
  try {
    const { command, fixedArgs } = covenLaunchCommand();
    const { stdout } = await execFileAsync(
      command,
      [...fixedArgs, "daemon", "status", "--json"],
      {
        encoding: "utf8",
        env: {
          ...harnessSpawnEnv(),
          ...(diagnostics ? {
            COVEN_CAVE_CORRELATION_ID: diagnostics.correlationId,
            COVEN_CAVE_DIAGNOSTIC_GENERATION: String(diagnostics.generation),
          } : {}),
        },
        timeout: 2_500,
        windowsHide: true,
      },
    );
    return parseDaemonLifecycleInspection(JSON.parse(stdout));
  } catch {
    return { status: "unknown" };
  }
}

/**
 * Process output can contain local paths, npm configuration, and credentials.
 * Keep the bounded, structured launch result useful without turning a failed
 * start into a diagnostics exfiltration path.
 */
export function sanitizeDaemonStartDiagnostic(value: string): string {
  return sanitizeAboutDiagnosticText(value);
}

const daemonStartCoordinator = new RuntimeStartupCoordinator<DaemonStartResult>();
export type DaemonStartOperation = {
  diagnostics: DaemonDiagnosticContext;
  result: Promise<DaemonStartResult>;
};
let activeDaemonStart: DaemonStartOperation | null = null;

function hasTestSeam(options: StartLocalDaemonOptions): boolean {
  return Boolean(
    options.probe
    || options.readHealthDocument
    || options.spawnImpl
    || options.terminateLaunchTree
    || options.installedVersion
    || options.inspectAddress
    || options.launchCommand
    || options.spawnEnvironment
    || options.platform,
  );
}

/**
 * One next step for an address someone else already holds. Deliberately names
 * no socket path, PID, or command line: this crosses the API boundary, and the
 * diagnostics sanitizer would redact a home-relative path into uselessness
 * anyway.
 */
const ADDRESS_IN_USE_DIAGNOSTIC =
  "Another process is already using the local Coven daemon address. Stop that process, or restart Cave so it can reconnect, then try again.";

export function startLocalDaemonOperation(
  options: StartLocalDaemonOptions = {},
): DaemonStartOperation {
  const diagnostics = options.diagnostics ?? createDaemonDiagnosticContext();
  if (hasTestSeam(options)) {
    return {
      diagnostics,
      result: runLocalDaemonStart({ ...options, diagnostics }),
    };
  }
  if (activeDaemonStart) return activeDaemonStart;

  const result = daemonStartCoordinator.run(
    () => runLocalDaemonStart({ ...options, diagnostics }),
    (retryAfterMs) => {
      const throttledResult: DaemonStartResult = {
        ok: false,
        code: "restart_throttled",
        error: `Cave paused repeated daemon restarts. Try again in ${Math.ceil(retryAfterMs / 1_000)} seconds.`,
        stdout: "",
        stderr: "",
        status: 429,
        readinessAttempts: 0,
        elapsedMs: 0,
        launchMode: "none",
      };
      recordDaemonDiagnosticEvent(diagnostics, {
        component: "next",
        operation: options.automatic ? "daemon-recovery" : "daemon-start",
        phase: "admission",
        outcome: "deferred",
        process: { pid: process.pid },
        endpoint: { kind: "local-socket", classification: "restart-throttled" },
        error: diagnosticError(throttledResult.error, throttledResult.code),
      });
      return throttledResult;
    },
    (operationResult) => operationResult.ok,
  );
  const operation: DaemonStartOperation = {
    diagnostics,
    result,
  };
  activeDaemonStart = operation;
  const releaseOperation = () => {
    if (activeDaemonStart === operation) activeDaemonStart = null;
  };
  void result.then(releaseOperation, releaseOperation);
  return operation;
}

export function startLocalDaemon(
  options: StartLocalDaemonOptions = {},
): Promise<DaemonStartResult> {
  return startLocalDaemonOperation(options).result;
}

async function runLocalDaemonStart(
  options: StartLocalDaemonOptions,
): Promise<DaemonStartResult> {
  const diagnostics = options.diagnostics ?? createDaemonDiagnosticContext();
  const operation = options.automatic ? "daemon-recovery" : "daemon-start";
  const startedAt = Date.now();
  recordDaemonDiagnosticEvent(diagnostics, {
    component: "next",
    operation,
    phase: "startup",
    outcome: "started",
    process: { pid: process.pid },
    endpoint: { kind: "local-socket", classification: "local-daemon" },
  });
  try {
    const result = await runLocalDaemonStartCore({ ...options, diagnostics });
    recordDaemonDiagnosticEvent(diagnostics, {
      component: "next",
      operation,
      phase: "startup",
      durationMs: Date.now() - startedAt,
      outcome: result.ok ? "succeeded" : result.code === "readiness_timeout"
        ? "timed-out"
        : result.code === "owner_unreachable" || result.code === "restart_throttled"
          ? "deferred"
          : "failed",
      process: { pid: process.pid },
      endpoint: {
        kind: "local-socket",
        classification: result.ok
          ? result.alreadyRunning ? "already-running" : "ready"
          : result.code,
        status: result.ok ? 200 : result.status,
      },
      error: result.ok ? null : diagnosticError(result.error, result.code),
    });
    return result;
  } catch (error) {
    recordDaemonDiagnosticEvent(diagnostics, {
      component: "next",
      operation,
      phase: "startup",
      durationMs: Date.now() - startedAt,
      outcome: "failed",
      process: { pid: process.pid },
      endpoint: { kind: "local-socket", classification: "unexpected-error" },
      error: diagnosticError(error, "unexpected-error"),
    });
    throw error;
  }
}

async function runLocalDaemonStartCore({
  restart: restartRequested = false,
  automatic = false,
  healthTimeoutMs = 1500,
  startTimeoutMs = 8000,
  readinessPollMs = 250,
  probe: probeOverride,
  readHealthDocument: readHealthDocumentOverride,
  installedVersion,
  inspectAddress = () => inspectDaemonAddress({ socketPath: socketPath() }),
  launchCommand = () => {
    const launch = covenLaunchCommand();
    return {
      command: launch.command,
      args: [...launch.fixedArgs, "daemon", "start"],
      // An unreadable third-party batch shim cannot be safely decomposed.
      // Preserve the legacy fallback for that one case; verified npm shims
      // launch their target directly so paths with spaces remain one argv.
      shell: launch.unresolvedWindowsShim === true,
    };
  },
  spawnEnvironment = harnessSpawnEnv,
  spawnImpl = spawn,
  terminateLaunchTree = terminateDaemonLaunchTree,
  inspectLifecycle,
  platform = process.platform,
  diagnostics = createDaemonDiagnosticContext(),
}: StartLocalDaemonOptions = {}): Promise<DaemonStartResult> {
  // The lifecycle preflight below is the whole point of the automatic path, and
  // `restart` skips it. Both flags arrive from a request body, so an automatic
  // request never restarts — otherwise `{automatic, restart}` spawns a competing
  // daemon against a live owner.
  const restart = automatic ? false : restartRequested;
  const compatibilityState: { current: DaemonStartupCompatibility | null } = { current: null };
  const currentCompatibility = (): DaemonStartupCompatibility | null => compatibilityState.current;
  const expectedVersion = probeOverride ? null : await (installedVersion ?? installedCovenVersion)();
  const readHealthDocument = readHealthDocumentOverride ?? (async () => {
    const response = await callDaemonTarget<DaemonStartupHealth>(localDaemonTarget(), {
      path: "/api/v1/health",
      timeoutMs: healthTimeoutMs,
      retryTransportFailure: false,
      diagnostics,
      diagnosticOperation: automatic ? "daemon-recovery-health" : "daemon-start-health",
    });
    return response.ok && response.data ? response.data : null;
  });
  const probe = probeOverride ?? (async () => {
    const health = await readHealthDocument();
    if (!health) return { ok: false };
    compatibilityState.current = assessDaemonStartupCompatibility(health, expectedVersion);
    return { ok: compatibilityState.current.ok };
  });
  const startedAt = Date.now();
  if (!restart) {
    const initialProbe = await probe();
    const compatibility = currentCompatibility();
    if (compatibility && !compatibility.ok) {
      return {
        ok: false,
        code: "runtime_incompatible",
        error: compatibility.diagnostic,
        stdout: "",
        stderr: "",
        status: 409,
        readinessAttempts: 1,
        elapsedMs: Date.now() - startedAt,
        launchMode: "none",
      };
    }
    if (initialProbe.ok) {
      return { ok: true, alreadyRunning: true, readinessAttempts: 1, elapsedMs: Date.now() - startedAt, launchMode: "none" };
    }
  }

  if (automatic && !restart) {
    const lifecycle = await (inspectLifecycle ?? (() => inspectDaemonLifecycle(diagnostics)))();
    if (lifecycle.status === "running") {
      return { ok: true, alreadyRunning: true, readinessAttempts: 2, elapsedMs: Date.now() - startedAt, launchMode: "none" };
    }
    if (lifecycle.status !== "stopped") {
      return {
        ok: false,
        code: "owner_unreachable",
        error: lifecycle.status === "stale"
          ? "daemon owner is still running but health is unavailable; automatic recovery deferred"
          : "daemon lifecycle could not be confirmed; automatic recovery deferred",
        stdout: "",
        stderr: "",
        status: 409,
        readinessAttempts: 2,
        elapsedMs: Date.now() - startedAt,
        launchMode: "none",
      };
    }
  }

  // Reaching here without `restart` means the health probe already failed, so
  // an address that is nonetheless bound belongs to something Cave cannot
  // adopt. Spawning against it produces a launcher that dies on its own bind
  // and a diagnostic that names neither cause nor next step, so refuse by name
  // instead. `restart` skips this deliberately: the address it would find
  // occupied is the very daemon the caller asked to replace.
  if (!restart) {
    const occupancy = await inspectAddress();
    if (occupancy === "occupied") {
      return {
        ok: false,
        code: "address_in_use",
        error: ADDRESS_IN_USE_DIAGNOSTIC,
        stdout: "",
        stderr: "",
        status: 409,
        readinessAttempts: automatic ? 2 : 1,
        elapsedMs: Date.now() - startedAt,
        launchMode: "none",
      };
    }
  }

  const launchMode = platform === "win32" ? "shell" : "direct";
  const launch = launchCommand();
  const child = spawnImpl(launch.command, launch.args, {
    stdio: ["ignore", "pipe", "pipe"],
    // POSIX uses an owned process group so timeout cleanup cannot strand a
    // foreground shell's daemon descendant. Windows owns its shell tree via
    // taskkill /T instead, where detached process groups do not provide this.
    detached: launchMode === "direct",
    // The daemon must never hold scoped vault secrets: daemon-launched
    // sessions would inherit them wholesale. Scoped keys flow only through
    // Cave's own per-familiar spawn path (cave-4nu6).
    env: {
      ...spawnEnvironment(),
      COVEN_CAVE_CORRELATION_ID: diagnostics.correlationId,
      COVEN_CAVE_DIAGNOSTIC_GENERATION: String(diagnostics.generation),
      COVEN_CAVE_DIAGNOSTIC_OPERATION: automatic ? "daemon-recovery" : "daemon-start",
      COVEN_CAVE_DIAGNOSTIC_ATTEMPT: "1",
    },
    shell: launch.shell ?? false,
  });
  let stdout = "";
  let stderr = "";
  let exitCode: number | null | undefined;
  let spawnError: Error | null = null;
  child.stdout?.on("data", (d) => (stdout += d.toString()));
  child.stderr?.on("data", (d) => (stderr += d.toString()));
  child.on("close", (code) => { exitCode = code; });
  child.on("error", (error) => { spawnError = error; });
  // TypeScript's control-flow analysis cannot observe event-callback writes
  // across an await. Read through a closure so the post-readiness state keeps
  // its declared Error | null shape.
  const launchError = () => spawnError;

  const readiness = await waitForDaemonReadiness({
    probe,
    timeoutMs: startTimeoutMs,
    pollMs: readinessPollMs,
    runnerExitGraceMs: Math.min(1_500, startTimeoutMs),
    runnerExited: () => spawnError !== null || exitCode !== undefined,
  });
  if (readiness.ready) {
    return {
      ok: true,
      alreadyRunning: false,
      readinessAttempts: readiness.attempts,
      elapsedMs: Date.now() - startedAt,
      launchMode,
      runner: readiness.runnerExited ? "exited" : "still-running",
      stdout: sanitizeDaemonStartDiagnostic(stdout),
      stderr: sanitizeDaemonStartDiagnostic(stderr),
    };
  }
  const compatibility = currentCompatibility();
  if (compatibility && !compatibility.ok) {
    const cleanup = await terminateLaunchTree(child);
    return {
      ok: false,
      code: "runtime_incompatible",
      error: compatibility.diagnostic,
      stdout: sanitizeDaemonStartDiagnostic(stdout),
      stderr: sanitizeDaemonStartDiagnostic(stderr),
      status: 409,
      readinessAttempts: readiness.attempts,
      elapsedMs: Date.now() - startedAt,
      launchMode,
      cleanup,
    };
  }
  const error = launchError();
  if (error) {
    if (isMissingExecutableError(error)) {
      const missing = covenCliMissingError();
      return {
        ok: false, code: "spawn_failed", error: sanitizeDaemonStartDiagnostic(missing.error),
        stdout: sanitizeDaemonStartDiagnostic(stdout), stderr: sanitizeDaemonStartDiagnostic(stderr),
        status: 500, readinessAttempts: readiness.attempts, elapsedMs: Date.now() - startedAt, launchMode,
      };
    }
    return {
      ok: false, code: "spawn_failed", error: sanitizeDaemonStartDiagnostic(error.message),
      stdout: sanitizeDaemonStartDiagnostic(stdout), stderr: sanitizeDaemonStartDiagnostic(stderr),
      status: 500, readinessAttempts: readiness.attempts, elapsedMs: Date.now() - startedAt, launchMode,
    };
  }
  // waitForDaemonReadiness has already made its deadline probe. Recheck once
  // immediately before cleanup so a just-published healthy daemon is never
  // terminated merely because its foreground launcher has exited or remains
  // attached. If this final probe is still unhealthy, clean up the owned tree
  // even when the launcher reported an early exit: an escaped descendant is
  // not allowed to survive an unsuccessful launch.
  if ((await probe()).ok) {
    return {
      ok: true,
      alreadyRunning: false,
      readinessAttempts: readiness.attempts + 1,
      elapsedMs: Date.now() - startedAt,
      launchMode,
      runner: exitCode === undefined ? "still-running" : "exited",
      stdout: sanitizeDaemonStartDiagnostic(stdout),
      stderr: sanitizeDaemonStartDiagnostic(stderr),
    };
  }
  // Capture this before cleanup. The owned-tree terminator deliberately
  // causes the child to close (often with a null code after SIGTERM); that is
  // evidence that cleanup worked, not that the launcher exited before its
  // readiness deadline.
  const runnerExitedBeforeCleanup = exitCode !== undefined;
  const cleanup = await terminateLaunchTree(child);
  // The preflight above cannot close the window between its probe and the
  // daemon's bind, and it never runs at all for `restart`. When the launcher
  // itself blames the address, that is a better answer than the exit it caused:
  // "the launcher exited" describes the symptom, this describes the cause.
  if (reportsDaemonAddressInUse(stdout, stderr)) {
    return {
      ok: false,
      code: "address_in_use",
      error: ADDRESS_IN_USE_DIAGNOSTIC,
      stdout: sanitizeDaemonStartDiagnostic(stdout),
      stderr: sanitizeDaemonStartDiagnostic(stderr),
      status: 409,
      readinessAttempts: readiness.attempts + 1,
      elapsedMs: Date.now() - startedAt,
      launchMode,
      exitCode,
      cleanup,
    };
  }
  if (runnerExitedBeforeCleanup) {
    return {
      ok: false, code: "runner_exited", error: "daemon launcher exited before health became ready",
      stdout: sanitizeDaemonStartDiagnostic(stdout), stderr: sanitizeDaemonStartDiagnostic(stderr),
      status: 500, readinessAttempts: readiness.attempts + 1, elapsedMs: Date.now() - startedAt, launchMode, exitCode, cleanup,
    };
  }
  return {
    ok: false, code: "readiness_timeout", error: "daemon readiness timed out",
    stdout: sanitizeDaemonStartDiagnostic(stdout), stderr: sanitizeDaemonStartDiagnostic(stderr),
    status: 504, readinessAttempts: readiness.attempts + 1, elapsedMs: Date.now() - startedAt, launchMode, cleanup,
  };
}
