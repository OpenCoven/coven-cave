import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { callDaemonTarget, localDaemonTarget } from "@/lib/coven-daemon";
import { covenBin } from "@/lib/coven-bin";
import { covenCliMissingError, isMissingExecutableError } from "@/lib/coven-spawn-error";
import { harnessSpawnEnv } from "./harness-spawn-env.ts";
import { waitForDaemonReadiness } from "./daemon-readiness.ts";
import { sanitizeAboutDiagnosticText } from "./about-diagnostics.ts";

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
    code: "spawn_failed" | "runner_exited" | "readiness_timeout";
    error: string;
    stdout: string;
    stderr: string;
    status: 500 | 504;
    readinessAttempts: number;
    elapsedMs: number;
    launchMode: "shell" | "direct";
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
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return { attempted: true, completed: true, mode: "process-group" };
    }
    return { attempted: true, completed: false, mode: "process-group" };
  }
  if (await waitForExit(child, 500)) {
    return { attempted: true, completed: true, mode: "process-group" };
  }
  try {
    killProcessGroup(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      return { attempted: true, completed: false, mode: "process-group" };
    }
  }
  return { attempted: true, completed: await waitForExit(child, 500), mode: "process-group" };
}

type StartLocalDaemonOptions = {
  restart?: boolean;
  healthTimeoutMs?: number;
  startTimeoutMs?: number;
  readinessPollMs?: number;
  /** Test seams keep launch ownership and timeout cleanup executable. */
  probe?: () => Promise<{ ok: boolean }>;
  spawnImpl?: typeof spawn;
  terminateLaunchTree?: (child: ChildProcess) => Promise<DaemonLaunchCleanup>;
  platform?: NodeJS.Platform;
};

/**
 * Process output can contain local paths, npm configuration, and credentials.
 * Keep the bounded, structured launch result useful without turning a failed
 * start into a diagnostics exfiltration path.
 */
export function sanitizeDaemonStartDiagnostic(value: string): string {
  return sanitizeAboutDiagnosticText(value);
}

export async function startLocalDaemon({
  restart = false,
  healthTimeoutMs = 1500,
  startTimeoutMs = 8000,
  readinessPollMs = 250,
  probe: probeOverride,
  spawnImpl = spawn,
  terminateLaunchTree = terminateDaemonLaunchTree,
  platform = process.platform,
}: StartLocalDaemonOptions = {}): Promise<DaemonStartResult> {
  const probe = probeOverride ?? (() => callDaemonTarget(localDaemonTarget(), { path: "/api/v1/health", timeoutMs: healthTimeoutMs }));
  const startedAt = Date.now();
  if (!restart && (await probe()).ok) {
    return { ok: true, alreadyRunning: true, readinessAttempts: 1, elapsedMs: Date.now() - startedAt, launchMode: "none" };
  }

  const launchMode = platform === "win32" ? "shell" : "direct";
  const child = spawnImpl(covenBin(), ["daemon", "start"], {
    stdio: ["ignore", "pipe", "pipe"],
    // POSIX uses an owned process group so timeout cleanup cannot strand a
    // foreground shell's daemon descendant. Windows owns its shell tree via
    // taskkill /T instead, where detached process groups do not provide this.
    detached: launchMode === "direct",
    // The daemon must never hold scoped vault secrets: daemon-launched
    // sessions would inherit them wholesale. Scoped keys flow only through
    // Cave's own per-familiar spawn path (cave-4nu6).
    env: harnessSpawnEnv(),
    shell: launchMode === "shell",
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
  const cleanup = await terminateLaunchTree(child);
  if (exitCode !== undefined) {
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
