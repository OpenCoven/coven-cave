import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { callDaemon } from "@/lib/coven-daemon";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import { covenCliMissingError, isMissingExecutableError } from "@/lib/coven-spawn-error";

export const dynamic = "force-dynamic";

export async function POST() {
  // Idempotent start: if a daemon is already serving, don't spawn `coven daemon
  // start`. That subcommand *restarts* the daemon, which fights a supervisor
  // (e.g. a launchd KeepAlive agent) for the socket — the supervisor relaunches
  // its copy while the restart spawns another, churning the socket. A healthy
  // daemon means "start" has nothing to do, so report it as already running.
  const health = await callDaemon({ path: "/api/v1/health", timeoutMs: 1500 });
  if (health.ok) {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }

  return new Promise<Response>((resolve) => {
    const child = spawn(covenBin(), ["daemon", "start"], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      env: covenSpawnEnv(),
      // Windows npm exposes CLI shims as .cmd files. The daemon-start argv is
      // fixed by this route, so shell mode is safe here and lets Node launch
      // those shims instead of raising ENOENT after status already found them.
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(
        NextResponse.json(
          { ok: false, error: "timeout", stdout, stderr },
          { status: 504 },
        ),
      );
    }, 8000);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(
        NextResponse.json(
          isMissingExecutableError(err)
            ? covenCliMissingError()
            : { ok: false, error: err.message },
          { status: 500 },
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        NextResponse.json({ ok: code === 0, exitCode: code, stdout, stderr }),
      );
    });
  });
}
