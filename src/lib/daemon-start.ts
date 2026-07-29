import { spawn } from "node:child_process";
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
  };

type StartLocalDaemonOptions = {
  restart?: boolean;
  healthTimeoutMs?: number;
  startTimeoutMs?: number;
  readinessPollMs?: number;
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
}: StartLocalDaemonOptions = {}): Promise<DaemonStartResult> {
  const probe = () => callDaemonTarget(localDaemonTarget(), { path: "/api/v1/health", timeoutMs: healthTimeoutMs });
  const startedAt = Date.now();
  if (!restart && (await probe()).ok) {
    return { ok: true, alreadyRunning: true, readinessAttempts: 1, elapsedMs: Date.now() - startedAt, launchMode: "none" };
  }

  const launchMode = process.platform === "win32" ? "shell" : "direct";
  const child = spawn(covenBin(), ["daemon", "start"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
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
  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));
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
  if (exitCode !== undefined) {
    return {
      ok: false, code: "runner_exited", error: "daemon launcher exited before health became ready",
      stdout: sanitizeDaemonStartDiagnostic(stdout), stderr: sanitizeDaemonStartDiagnostic(stderr),
      status: 500, readinessAttempts: readiness.attempts, elapsedMs: Date.now() - startedAt, launchMode, exitCode,
    };
  }
  // Do not kill a launcher on timeout. On Windows a shell can have already
  // handed the daemon to a descendant; the final health probe above is the
  // authority, and killing by shell pid can leave that healthy child orphaned.
  return {
    ok: false, code: "readiness_timeout", error: "daemon readiness timed out",
    stdout: sanitizeDaemonStartDiagnostic(stdout), stderr: sanitizeDaemonStartDiagnostic(stderr),
    status: 504, readinessAttempts: readiness.attempts, elapsedMs: Date.now() - startedAt, launchMode,
  };
}
