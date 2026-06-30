import { spawn } from "node:child_process";
import { callDaemonTarget, localDaemonTarget } from "@/lib/coven-daemon";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import { covenCliMissingError, isMissingExecutableError } from "@/lib/coven-spawn-error";

export type DaemonStartResult =
  | { ok: true; alreadyRunning: true }
  | { ok: boolean; exitCode: number | null; restart: boolean; stdout: string; stderr: string }
  | { ok: false; error: string; stdout?: string; stderr?: string; status?: number };

type StartLocalDaemonOptions = {
  restart?: boolean;
  healthTimeoutMs?: number;
  startTimeoutMs?: number;
};

export async function startLocalDaemon({
  restart = false,
  healthTimeoutMs = 1500,
  startTimeoutMs = 8000,
}: StartLocalDaemonOptions = {}): Promise<DaemonStartResult> {
  if (!restart) {
    const health = await callDaemonTarget(localDaemonTarget(), { path: "/api/v1/health", timeoutMs: healthTimeoutMs });
    if (health.ok) return { ok: true, alreadyRunning: true };
  }

  return new Promise<DaemonStartResult>((resolve) => {
    const child = spawn(covenBin(), ["daemon", "start"], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      env: covenSpawnEnv(),
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, error: "timeout", stdout, stderr, status: 504 });
    }, startTimeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (isMissingExecutableError(err)) {
        const missing = covenCliMissingError();
        resolve({ ...missing, ok: false, status: 500 });
        return;
      }
      resolve({ ok: false, error: err.message, status: 500 });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, restart, stdout, stderr });
    });
  });
}
