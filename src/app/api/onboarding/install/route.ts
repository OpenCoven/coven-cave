import { NextResponse } from "next/server";
import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { stripAnsi } from "@/lib/ansi";
import {
  globalNpmInstallOwner,
  releaseGlobalNpmInstall,
  reserveGlobalNpmInstall,
  type NpmInstallLease,
} from "@/lib/server/global-npm-install-lane";
import {
  covenBin,
  covenSpawnEnv,
  pickWindowsLauncher,
  refreshCovenSpawnEnv,
} from "@/lib/coven-bin";
import { callDaemon } from "@/lib/coven-daemon";
import { installHermesShim } from "@/lib/hermes-shim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/**
 * One-click dependency installs for onboarding.
 *
 * Hard allowlist: the request names a TARGET, never a command. Every target
 * maps to a fixed install mechanism so nothing user-controlled ever reaches
 * a shell:
 *
 *   - kind "npm":    `npm install -g <pinned package>`
 *   - kind "script": the harness's official installer at a pinned HTTPS URL,
 *                    run byte-for-byte as its docs instruct users to run it
 *                    (bash on POSIX, PowerShell on Windows).
 */
const INSTALL_TARGETS = {
  "coven-cli": {
    kind: "npm",
    label: "Coven CLI",
    packageName: "@opencoven/cli@latest",
    binary: "coven",
    timeoutMs: 240_000,
  },
  "coven-code": {
    kind: "npm",
    label: "Coven Code",
    // Scoped package only — bare "coven-code" is a different, deprecated
    // npm package (see opencoven-tools-status.ts).
    packageName: "@opencoven/coven-code@latest",
    binary: "coven-code",
    timeoutMs: 240_000,
  },
  codex: {
    kind: "npm",
    label: "Codex",
    packageName: "@openai/codex",
    binary: "codex",
    timeoutMs: 240_000,
  },
  claude: {
    kind: "npm",
    label: "Claude Code",
    packageName: "@anthropic-ai/claude-code",
    binary: "claude",
    timeoutMs: 240_000,
  },
  copilot: {
    kind: "npm",
    label: "Copilot",
    packageName: "@github/copilot@latest",
    binary: "copilot",
    timeoutMs: 240_000,
  },
  openclaw: {
    kind: "npm",
    label: "OpenClaw",
    packageName: "openclaw@latest",
    binary: "openclaw",
    timeoutMs: 240_000,
  },
  hermes: {
    kind: "script",
    label: "Hermes",
    // Official installer (github.com/NousResearch/hermes-agent#quick-install).
    // It provisions its own dependencies (uv, Python, …), so no npm precheck.
    posix: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
    windows: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
    binary: "hermes",
    // Heavier than an npm install — it bootstraps a Python toolchain.
    timeoutMs: 600_000,
  },
} as const;

type InstallTarget = keyof typeof INSTALL_TARGETS;
type CommandPathResult = { path: string | null; error?: string };

function nodeInstallHint(): string {
  if (process.platform === "darwin") {
    return "Install Node.js LTS from https://nodejs.org or with `brew install node`, then click Install again.";
  }
  if (process.platform === "win32") {
    return "Install Node.js LTS from https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`), restart Cave so the new PATH applies, then click Install again.";
  }
  return "Install Node.js LTS from https://nodejs.org or your package manager (e.g. `sudo apt install nodejs npm`), then click Install again.";
}

async function commandPath(
  binary: string,
  opts: { refreshOnMiss?: boolean } = {},
): Promise<CommandPathResult> {
  const finder = process.platform === "win32" ? "where" : "which";
  const find = async (env: NodeJS.ProcessEnv) => {
    try {
      const { stdout } = await execFileAsync(finder, [binary], {
        env,
        timeout: 1500,
      });
      const lines = stdout.split(/\r?\n/);
      return {
        path:
          process.platform === "win32"
            ? pickWindowsLauncher(lines)
            : lines.map((l) => l.trim()).find(Boolean) ?? null,
      };
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 1) return { path: null };
      return {
        path: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
  const found = await find(covenSpawnEnv());
  if (found.path || found.error || !opts.refreshOnMiss) return found;
  return find(refreshCovenSpawnEnv());
}

function isInstallTarget(value: unknown): value is InstallTarget {
  return typeof value === "string" && value in INSTALL_TARGETS;
}

/** Walk up from `start` to the nearest directory that actually exists. The
 *  global npm dirs may not exist yet on a fresh prefix, so we check the
 *  closest existing ancestor for writability instead. */
async function nearestExistingDir(start: string): Promise<string | null> {
  let cur = start;
  for (let i = 0; i < 16; i++) {
    try {
      await access(cur);
      return cur;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return null;
      cur = parent;
    }
  }
  return null;
}

/** True when the current user can write the global npm install dirs. A
 *  root-owned prefix (system Node under /usr/local, distro packages) is what
 *  makes `npm install -g` fail with EACCES and need sudo. nvm/fnm/Homebrew
 *  prefixes are user-owned and return true here, so we never sudo them. */
async function npmGlobalDirsWritable(npm: string): Promise<boolean> {
  let prefix: string;
  try {
    const { stdout } = await execFileAsync(npm, ["prefix", "-g"], {
      env: covenSpawnEnv(),
      timeout: 5000,
    });
    prefix = stdout.trim();
  } catch {
    // Can't determine the prefix — don't force sudo on a guess.
    return true;
  }
  if (!prefix) return true;
  // npm writes the package tree under <prefix>/lib/node_modules and the bin
  // shims under <prefix>/bin on POSIX. Either being unwritable needs sudo.
  for (const dir of [join(prefix, "lib", "node_modules"), join(prefix, "bin")]) {
    const existing = await nearestExistingDir(dir);
    if (!existing) continue;
    try {
      await access(existing, fsConstants.W_OK);
    } catch {
      return false;
    }
  }
  return true;
}

type SpawnPlan = {
  command: string;
  args: string[];
  shell: boolean;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Resolve the fixed spawn plan for a target. Returns null when a
 *  prerequisite is missing (npm targets need npm on PATH). */
async function spawnPlanFor(
  target: (typeof INSTALL_TARGETS)[InstallTarget],
): Promise<
  | SpawnPlan
  | { npmMissing: true }
  | { commandLookupFailed: true; binary: string; error: string }
  | { sudoRequired: true; packageName: string }
  | null
> {
  if (target.kind === "npm") {
    const npmResult = await commandPath("npm", { refreshOnMiss: true });
    if (npmResult.error) {
      return {
        commandLookupFailed: true,
        binary: "npm",
        error: npmResult.error,
      };
    }
    const npm = npmResult.path;
    if (!npm) return { npmMissing: true };

    // On POSIX a root-owned global prefix (system Node, /usr/local) fails
    // `npm install -g` with EACCES. Do not elevate from this API route: even
    // with an allowlisted package and fixed argv, global npm installs may run
    // package lifecycle scripts and write system locations. Require the
    // operator to run the sudo command manually instead. nvm/fnm/Homebrew
    // prefixes are user-owned and return true here, so they stay one-click.
    if (process.platform !== "win32" && !(await npmGlobalDirsWritable(npm))) {
      return { sudoRequired: true, packageName: target.packageName };
    }

    return {
      command: npm,
      args: ["install", "-g", target.packageName],
      // Windows resolves npm to npm.cmd, which Node refuses to spawn without
      // a shell. The argv is fully fixed (allowlisted package, no user
      // input), so shell interpolation has nothing to grab.
      shell: process.platform === "win32",
    };
  }
  // kind === "script" — run the harness's official installer exactly as its
  // docs instruct. The command string is a pinned constant from the
  // allowlist above; the request never contributes to it.
  if (process.platform === "win32") {
    return {
      command: "powershell",
      args: ["-NoProfile", "-Command", target.windows],
      shell: false,
    };
  }
  return {
    command: "bash",
    args: ["-lc", target.posix],
    shell: false,
  };
}

type InstallJob = {
  status: "running" | "done";
  kind: "npm" | "script";
  startedAt: number;
  finishedAt?: number;
  /** Raw interleaved stdout+stderr, capped to OUTPUT_CAP. */
  output: string;
  ok?: boolean;
  code?: number | null;
  binaryPath?: string | null;
  error?: string;
  /** Cancels preparation or the spawned process; never exposed to clients. */
  cancel?: () => void;
  cancelRequested?: boolean;
};

/** Last ~8 KB of installer output is plenty for a progress tail and keeps
 *  long installs (Hermes bootstraps a Python toolchain) from growing
 *  unbounded in memory. */
const OUTPUT_CAP = 8_192;

// Next dev re-evaluates this module on HMR; a plain module-level Map would
// orphan running jobs. globalThis survives re-evaluation.
const globalScope = globalThis as unknown as {
  __covenInstallJobs?: Map<InstallTarget, InstallJob>;
};
const jobs: Map<InstallTarget, InstallJob> = (globalScope.__covenInstallJobs ??=
  new Map());

type NpmLaneView = {
  npmBusy: boolean;
  npmBusyTarget: InstallTarget | null;
  npmBusyLabel: string | null;
  npmJob?: ReturnType<typeof jobView>;
};

/**
 * The lease intentionally lives outside the jobs map. A request can spend time
 * on target-specific preparation before it reserves the npm tree, and the
 * final reservation has to be atomic across every npm target.
 */
function activeNpmInstallTarget(): InstallTarget | null {
  const owner = globalNpmInstallOwner();
  if (!owner || !isInstallTarget(owner)) return null;
  const job = jobs.get(owner);
  if (job?.status === "running" && job.kind === "npm") return owner;
  // Recovery after HMR/reload: a completed or orphaned job must never leave
  // the process-wide lease stuck. This only clears the same owner, so it
  // cannot release a newer reservation.
  releaseGlobalNpmInstall(owner);
  return null;
}

function npmLaneView(): NpmLaneView {
  const target = activeNpmInstallTarget();
  if (!target) {
    return { npmBusy: false, npmBusyTarget: null, npmBusyLabel: null };
  }
  const job = jobs.get(target);
  return {
    npmBusy: true,
    npmBusyTarget: target,
    npmBusyLabel: INSTALL_TARGETS[target].label,
    ...(job ? { npmJob: jobView(job) } : {}),
  };
}

function npmBusyResponse(owner: InstallTarget) {
  return NextResponse.json(
    {
      ok: false,
      retryable: true,
      code: "npm_install_in_progress",
      error: `${INSTALL_TARGETS[owner].label} is updating the shared global npm directory. Wait for it to finish, then retry.`,
      ...npmLaneView(),
    },
    { status: 409, headers: { "Retry-After": "2" } },
  );
}

function appendOutput(job: InstallJob, chunk: string) {
  job.output = (job.output + chunk).slice(-OUTPUT_CAP);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runCommand(
  command: string,
  args: string[],
  options: { shell: boolean; timeoutMs: number },
): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: covenSpawnEnv(),
      shell: options.shell,
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    child.stdout.on("data", (data) => {
      output += stripAnsi(data.toString());
    });
    child.stderr.on("data", (data) => {
      output += stripAnsi(data.toString());
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, signal: null, output: err.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });
}

async function prepareForInstall(
  targetName: InstallTarget,
  target: (typeof INSTALL_TARGETS)[InstallTarget],
  job: InstallJob,
) {
  if (targetName !== "coven-cli") return;
  appendOutput(job, "Preparing Coven CLI update: checking daemon lock state...\n");
  const health = await callDaemon<{ ok?: boolean; daemon?: { pid?: number } }>({
    path: "/api/v1/health",
    timeoutMs: 800,
  });
  const pid = health.data?.daemon?.pid;
  if (!health.ok || typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    appendOutput(job, "No reachable Coven daemon reported a live pid; continuing.\n");
    return;
  }

  appendOutput(job, `Stopping Coven daemon before updating ${target.label} (pid ${pid})...\n`);
  const stop = await runCommand(covenBin(), ["daemon", "stop"], {
    shell: process.platform === "win32",
    timeoutMs: 8_000,
  });
  if (stop.output.trim()) appendOutput(job, `${stop.output.trim()}\n`);
  appendOutput(
    job,
    stop.code === 0
      ? "Coven daemon stop command completed; verifying process exit...\n"
      : `Coven daemon stop exited ${stop.code === null ? `signal ${stop.signal ?? "unknown"}` : `code ${stop.code}`}; verifying process exit...\n`,
  );
  await sleep(500);

  if (!isProcessAlive(pid)) {
    appendOutput(job, "Coven daemon is stopped; continuing with npm update.\n");
    return;
  }

  appendOutput(job, `Coven daemon is still running; terminating pid ${pid} to unlock coven.exe...\n`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    appendOutput(
      job,
      `Could not terminate daemon pid ${pid}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }
  await sleep(500);
  appendOutput(
    job,
    isProcessAlive(pid)
      ? "Warning: daemon process still appears to be running; npm may report a file lock.\n"
      : "Daemon process terminated; continuing with npm update.\n",
  );
}

function installFailureHint(targetName: InstallTarget, output: string): string | null {
  if (
    targetName === "coven-cli" &&
    /(EBUSY|resource busy|locked|coven\.exe)/i.test(output)
  ) {
    return "coven.exe is still locked by a running daemon. Cave tried to stop it first; fully quit Cave, end the coven process in Task Manager if it remains, then retry the update.";
  }
  // Backstop for a non-writable global prefix that slipped past the upfront
  // writability check (race, or a prefix we couldn't resolve): npm reports a
  // permission error and the user needs to re-run the install with sudo.
  const target = INSTALL_TARGETS[targetName];
  if (
    target.kind === "npm" &&
    /(EACCES|EPERM|EROFS|permission denied)/i.test(output)
  ) {
    return `npm couldn't write to the global directory (permission denied). Re-run the install in a terminal with sudo: \`sudo npm install -g ${target.packageName}\`.`;
  }
  return null;
}

function jobView(job: InstallJob) {
  const tail = job.output.slice(-2000);
  const elapsedMs = (job.finishedAt ?? Date.now()) - job.startedAt;
  if (job.status === "running") {
    return { status: "running" as const, elapsedMs, tail };
  }
  return {
    status: "done" as const,
    elapsedMs,
    tail,
    ok: job.ok ?? false,
    code: job.code ?? null,
    binaryPath: job.binaryPath ?? null,
    ...(job.error ? { error: job.error } : {}),
  };
}

function installStartErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/resource temporarily unavailable|EAGAIN|uv_thread_create/i.test(message)) {
    return "Cave could not start the installer because the system is temporarily out of process slots. Wait a moment, then click Install again.";
  }
  return message || "install failed to start";
}

function finishInstallJobError(
  job: InstallJob,
  err: unknown,
  npmLease?: NpmInstallLease,
) {
  if (job.status !== "running") return;
  job.status = "done";
  job.finishedAt = Date.now();
  job.ok = false;
  job.error = installStartErrorMessage(err);
  job.cancel = undefined;
  npmLease?.release();
}

function finishInstallJob(
  job: InstallJob,
  result: {
    ok: boolean;
    code: number | null;
    binaryPath: string | null;
    error?: string;
  },
  npmLease?: NpmInstallLease,
) {
  if (job.status !== "running") return;
  job.status = "done";
  job.finishedAt = Date.now();
  job.ok = result.ok;
  job.code = result.code;
  job.binaryPath = result.binaryPath;
  if (result.error) job.error = result.error;
  job.cancel = undefined;
  npmLease?.release();
}

/**
 * Run one already-reserved install job. The lease is released from every
 * terminal path (spawn error, normal close, cancellation, and the timeout
 * watchdog), rather than from client polling.
 */
async function runInstallJob(
  targetName: InstallTarget,
  target: (typeof INSTALL_TARGETS)[InstallTarget],
  plan: SpawnPlan,
  job: InstallJob,
  npmLease?: NpmInstallLease,
) {
  let child: ReturnType<typeof spawn> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let forceFinishTimer: NodeJS.Timeout | undefined;
  let terminationRequested = false;

  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    if (forceFinishTimer) clearTimeout(forceFinishTimer);
  };
  const fail = (err: unknown) => {
    clearTimers();
    finishInstallJobError(job, err, npmLease);
  };
  const requestTermination = (reason: string) => {
    if (!child || terminationRequested) return;
    terminationRequested = true;
    if (timer) clearTimeout(timer);
    appendOutput(job, `${reason}\n`);
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child?.kill("SIGKILL"), 10_000);
    // A misbehaving child must not keep the UI or the npm lane stuck forever.
    // SIGKILL/TerminateProcess has already been requested at this point; this
    // watchdog only settles the in-memory job if Node never emits `close`.
    forceFinishTimer = setTimeout(
      () => fail(new Error(job.error ?? reason)),
      11_000,
    );
  };

  job.cancel = () => {
    if (job.status !== "running" || job.cancelRequested) return;
    job.cancelRequested = true;
    job.error = "install cancelled";
    if (!child) {
      appendOutput(job, "Cancellation requested during preparation.\n");
      return;
    }
    requestTermination("Cancellation requested; stopping installer...");
  };

  try {
    try {
      await prepareForInstall(targetName, target, job);
    } catch (err) {
      appendOutput(
        job,
        `Preparation warning: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    if (job.cancelRequested) {
      fail(new Error("install cancelled"));
      return;
    }

    child = spawn(plan.command, plan.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: covenSpawnEnv(),
      shell: plan.shell,
    });
    child.stdout?.on("data", (d) => appendOutput(job, stripAnsi(d.toString())));
    child.stderr?.on("data", (d) => appendOutput(job, stripAnsi(d.toString())));
    timer = setTimeout(() => {
      job.error = `install timed out after ${target.timeoutMs / 1000}s`;
      requestTermination(`${job.error}; stopping installer...`);
    }, target.timeoutMs);
    child.on("error", (err) => fail(err));
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      void (async () => {
        if (job.status !== "running") return;
        if (job.cancelRequested) {
          fail(new Error("install cancelled"));
          return;
        }
        const installed = await commandPath(target.binary);
        const installedPath = installed.path;
        const ok = code === 0 && !!installedPath && !job.error;

        // Hermes has no positional prompt slot, so Cave installs its adapter
        // shim beside a successful Hermes binary. This is best-effort: a shim
        // write failure must not turn a completed installer into a failed job.
        if (ok && targetName === "hermes" && installedPath) {
          try {
            const shim = await installHermesShim(installedPath);
            appendOutput(
              job,
              shim.ok
                ? `Installed hermes-coven shim at ${shim.path}\n`
                : `Note: could not install hermes-coven shim (${shim.error}); ` +
                  "chat may fail until it is installed manually.\n",
            );
          } catch (err) {
            appendOutput(
              job,
              `Note: could not install hermes-coven shim (${err instanceof Error ? err.message : String(err)}); chat may fail until it is installed manually.\n`,
            );
          }
        }
        clearTimers();
        finishInstallJob(
          job,
          {
            ok,
            code,
            binaryPath: installedPath,
            ...(!ok && !job.error
              ? {
                  error: installed.error
                    ? `Could not verify ${target.binary} on PATH after install: ${installed.error}`
                    : installFailureHint(targetName, job.output) ??
                      (code === 0
                        ? `${target.binary} still is not on PATH after install — open a new terminal or restart Cave, then re-check.`
                        : `installer exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}`),
                }
              : {}),
          },
          npmLease,
        );
      })().catch((err) => fail(err));
    });
  } catch (err) {
    fail(err);
  }
}

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("target");
  // Client surfaces poll this lightweight lane view so a job started from a
  // different surface/window disables its own npm actions immediately.
  if (target === null) {
    return NextResponse.json({ status: "idle", ...npmLaneView() });
  }
  if (!isInstallTarget(target)) {
    return NextResponse.json(
      { ok: false, error: "unknown install target" },
      { status: 400 },
    );
  }
  const job = jobs.get(target);
  if (!job) return NextResponse.json({ status: "idle", ...npmLaneView() });
  return NextResponse.json({ ...jobView(job), ...npmLaneView() });
}

export async function DELETE(req: Request) {
  const target = new URL(req.url).searchParams.get("target");
  if (!isInstallTarget(target)) {
    return NextResponse.json(
      { ok: false, error: "unknown install target" },
      { status: 400 },
    );
  }
  const job = jobs.get(target);
  if (!job || job.status !== "running") {
    return NextResponse.json(
      { ok: false, error: "no running install for this target", ...npmLaneView() },
      { status: 409 },
    );
  }
  job.cancel?.();
  return NextResponse.json({
    ok: true,
    cancelling: true,
    ...jobView(job),
    ...npmLaneView(),
  });
}

export async function POST(req: Request) {
  let body: { target?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }

  if (!isInstallTarget(body.target)) {
    return NextResponse.json(
      { ok: false, error: "unknown install target" },
      { status: 400 },
    );
  }
  const targetName = body.target;
  const target = INSTALL_TARGETS[targetName];

  // Idempotent re-POST: same body shape as GET, no duplicate spawn.
  const existing = jobs.get(targetName);
  if (existing?.status === "running") {
    return NextResponse.json(jobView(existing));
  }

  // This early check keeps the ordinary busy path quick. The authoritative,
  // atomic reservation comes *after* spawnPlanFor below, because that function
  // awaits target preparation and two requests can pass this check together.
  if (target.kind === "npm") {
    const activeTarget = activeNpmInstallTarget();
    if (activeTarget) return npmBusyResponse(activeTarget);
  }

  const plan = await spawnPlanFor(target);
  if (plan && "npmMissing" in plan) {
    return NextResponse.json(
      {
        ok: false,
        npmMissing: true,
        error: "npm is not available on PATH",
        hint: nodeInstallHint(),
      },
      { status: 422 },
    );
  }
  if (plan && "commandLookupFailed" in plan) {
    return NextResponse.json(
      {
        ok: false,
        commandLookupFailed: true,
        error: `Cave couldn't check ${plan.binary} on PATH`,
        hint: `Retry in a moment. If it keeps happening, quit stuck terminal/session processes and try again. Details: ${plan.error}`,
      },
      { status: 503 },
    );
  }
  if (plan && "sudoRequired" in plan) {
    return NextResponse.json(
      {
        ok: false,
        sudoRequired: true,
        error: "the global npm directory needs elevated permissions to write",
        hint: `Cave can't write to the global npm directory from this API route. Run \`sudo npm install -g ${plan.packageName}\` in a terminal, then click Install again.`,
      },
      { status: 422 },
    );
  }
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: "no install plan for this platform" },
      { status: 500 },
    );
  }

  // Re-check after the await above: two near-simultaneous POSTs for the same
  // target could otherwise both pass the running-check and double-spawn.
  const recheck = jobs.get(targetName);
  if (recheck?.status === "running") {
    return NextResponse.json(jobView(recheck));
  }

  // This is the atomic boundary. It comes after every asynchronous plan
  // lookup/preparation step and covers every npm allowlist target, rather than
  // only the requested target. Script installers intentionally do not reserve
  // it and may continue under the existing independent-installer policy.
  const reservation =
    target.kind === "npm" ? reserveGlobalNpmInstall(targetName) : null;
  if (reservation && !reservation.ok) {
    const owner = isInstallTarget(reservation.owner)
      ? reservation.owner
      : targetName;
    return npmBusyResponse(owner);
  }
  const npmLease = reservation?.ok ? reservation.lease : undefined;

  const job: InstallJob = {
    status: "running",
    kind: target.kind,
    startedAt: Date.now(),
    output: "",
  };
  jobs.set(targetName, job);

  void runInstallJob(targetName, target, plan, job, npmLease);

  return NextResponse.json(
    { started: true, target: targetName, ...npmLaneView() },
    { status: 202 },
  );
}
