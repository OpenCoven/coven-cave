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
  refreshCovenBin,
  refreshCovenSpawnEnv,
} from "@/lib/coven-bin";
import { installHermesShim } from "@/lib/hermes-shim";
import {
  npmLaunchCommandForPath,
  verifyOpenCovenToolInstall,
  type OpenCovenToolVerification,
} from "@/lib/opencoven-tools-status";
import { invalidateOpenCovenToolUpdateCache } from "@/lib/opencoven-tools-update-cache";
import { isVerifiedOpenCovenInstallSuccess } from "@/lib/opencoven-tool-verification";
import { resolveStaleOpenCovenLaunchers } from "@/lib/opencoven-tools-resolve";
import { callDaemonTarget, localDaemonTarget } from "@/lib/coven-daemon";
import { startLocalDaemon } from "@/lib/daemon-start";
import { redactSecretText } from "@/lib/secret-redaction";
import {
  markDaemonCliInstalling,
  daemonUpdateTraceLine,
  prepareDaemonForCliUpdate,
  recoverDaemonAfterCliUpdate,
  type DaemonCommandResult,
  type DaemonUpdateDependencies,
  type DaemonUpdateLifecycle,
} from "@/lib/daemon-update-lifecycle";

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

function isOpenCovenToolInstallTarget(
  target: InstallTarget,
): target is "coven-cli" {
  return target === "coven-cli";
}

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
  opts: { refresh?: boolean; refreshOnMiss?: boolean } = {},
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
  const found = await find(opts.refresh ? refreshCovenSpawnEnv() : covenSpawnEnv());
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

    const launch = npmLaunchCommandForPath(npm);
    if (!launch) {
      return {
        commandLookupFailed: true,
        binary: "npm runtime",
        error: `Could not resolve npm-cli.js from ${npm}`,
      };
    }

    return {
      command: launch.command,
      args: [...launch.fixedArgs, "install", "-g", target.packageName],
      // Node 24 concatenates shell:true argv without escaping. A Windows npm
      // path such as C:\Program Files\nodejs\npm.cmd is consequently truncated
      // to C:\Program and exits 1. npmLaunchCommandForPath remaps the shim to
      // `node npm-cli.js`, preserving fixed argv without cmd.exe.
      shell: false,
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
  verification?: OpenCovenToolVerification;
  error?: string;
  /** Present only for a Coven CLI update, never for other tool installers. */
  daemon?: DaemonUpdateLifecycle;
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

function redactSensitiveInstallOutput(value: string): string {
  return redactSecretText(value).replace(
    /^.*(?:GITHUB_(?:PAT|PERSONAL_ACCESS_TOKEN)|NPM_CONFIG_.*(?:AUTH|TOKEN)|(?:^|[_-])TOKEN)\s*=.*$/gim,
    "[redacted sensitive installer output]",
  );
}

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
  job.output = redactSensitiveInstallOutput(job.output + stripAnsi(chunk)).slice(-OUTPUT_CAP);
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
      output = redactSensitiveInstallOutput(output + stripAnsi(data.toString()));
    });
    child.stderr.on("data", (data) => {
      output = redactSensitiveInstallOutput(output + stripAnsi(data.toString()));
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

type LocalDaemonHealth = { ok?: boolean; daemon?: { pid?: number } };

function commandResultDetail(result: {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}): string {
  const exit = result.code === null ? `signal ${result.signal ?? "unknown"}` : `code ${result.code}`;
  return result.output.trim() ? `${exit}: ${result.output.trim()}` : exit;
}

function daemonLifecycleDependencies(job: InstallJob): DaemonUpdateDependencies {
  // A CLI update only ever touches the laptop-local daemon. The configured
  // target can be a remote hub, whose health and PID must never influence this
  // machine's updater lifecycle. Resolve it for every probe: Windows daemon
  // restarts write a new pipe name to daemon.json, so holding the pre-update
  // target would make an otherwise healthy recovery look offline.
  return {
    checkHealth: async () => {
      const health = await callDaemonTarget<LocalDaemonHealth>(localDaemonTarget(), {
        path: "/api/v1/health",
        timeoutMs: 800,
      });
      const reachable = health.ok && health.data?.ok !== false;
      return {
        ok: reachable,
        ...(reachable
          ? {}
          : { detail: health.error ?? (health.ok ? "daemon reported unhealthy" : `daemon http ${health.status}`) }),
      };
    },
    stop: async (): Promise<DaemonCommandResult> => {
      const stop = await runCommand(covenBin(), ["daemon", "stop"], {
        shell: process.platform === "win32",
        timeoutMs: 8_000,
      });
      return { ok: stop.code === 0, detail: commandResultDetail(stop) };
    },
    start: async (): Promise<DaemonCommandResult> => {
      const started = await startLocalDaemon({ healthTimeoutMs: 800, startTimeoutMs: 8_000 });
      if (started.ok) {
        return {
          ok: true,
          detail: "alreadyRunning" in started && started.alreadyRunning
            ? "daemon was already running"
            : "daemon start completed",
        };
      }
      const details = "error" in started
        ? started.error
        : [started.stderr, started.stdout].filter(Boolean).join("\n") || `exit ${started.exitCode ?? "unknown"}`;
      return { ok: false, detail: details };
    },
    refreshExecutable: () => {
      refreshCovenBin();
      refreshCovenSpawnEnv();
    },
    wait: sleep,
    onState: (daemon) => {
      job.daemon = daemon;
      appendOutput(job, daemonUpdateTraceLine(daemon));
    },
  };
}

async function prepareForInstall(targetName: InstallTarget, job: InstallJob): Promise<boolean> {
  if (targetName !== "coven-cli") return true;
  appendOutput(job, "Preparing Coven CLI update: checking local daemon lifecycle...\n");
  const dependencies = daemonLifecycleDependencies(job);
  const prepared = await prepareDaemonForCliUpdate(dependencies);
  job.daemon = prepared.lifecycle;
  if (prepared.canInstall && prepared.lifecycle.wasRunning) {
    job.daemon = markDaemonCliInstalling(prepared.lifecycle, dependencies);
  }
  return prepared.canInstall;
}

async function recoverDaemonAfterCliInstall(targetName: InstallTarget, job: InstallJob): Promise<boolean> {
  if (targetName !== "coven-cli" || !job.daemon) return true;
  const recovered = await recoverDaemonAfterCliUpdate(job.daemon, daemonLifecycleDependencies(job));
  job.daemon = recovered.lifecycle;
  return recovered.ok;
}

function installFailureHint(targetName: InstallTarget, output: string): string | null {
  if (
    targetName === "coven-cli" &&
    /(EBUSY|resource busy|locked|coven\.exe)/i.test(output)
  ) {
    return "coven.exe is still locked. Cave only uses graceful local-daemon shutdown and never terminates a process by PID. Quit the process that owns the file (or restart Cave), then retry the update.";
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
    return {
      status: "running" as const,
      elapsedMs,
      tail,
      ...(job.daemon ? { daemon: job.daemon } : {}),
    };
  }
  return {
    status: "done" as const,
    elapsedMs,
    tail,
    ok: job.ok ?? false,
    code: job.code ?? null,
    binaryPath: job.binaryPath ?? null,
    ...(job.verification ? { verification: job.verification } : {}),
    ...(job.daemon ? { daemon: job.daemon } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function installStartErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/resource temporarily unavailable|EAGAIN|uv_thread_create/i.test(message)) {
    return "Cave could not start the installer because the system is temporarily out of process slots. Wait a moment, then click Install again.";
  }
  if (!message) return "install failed to start";
  return "Cave could not start the installer. Retry in a moment; if it continues, copy diagnostics for support.";
}

function finishInstallJobError(
  job: InstallJob,
  err: unknown,
  npmLease?: NpmInstallLease,
  safeMessage?: string,
) {
  if (job.status !== "running") return;
  job.status = "done";
  job.finishedAt = Date.now();
  job.ok = false;
  job.error = safeMessage ?? installStartErrorMessage(err);
  job.cancel = undefined;
  npmLease?.release();
}

function installerOutcomeError(
  targetName: InstallTarget,
  target: (typeof INSTALL_TARGETS)[InstallTarget],
  code: number | null,
  signal: NodeJS.Signals | null,
  installed: CommandPathResult,
  output: string,
  priorError?: string,
): string | null {
  if (priorError) return priorError;
  if (installed.error) {
    return `Could not verify ${target.binary} on PATH after install: ${installed.error}`;
  }
  if (code === 0 && installed.path) return null;
  return installFailureHint(targetName, output) ??
    (code === 0
      ? `${target.binary} still is not on PATH after install — open a new terminal or restart Cave, then re-check.`
      : `installer exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}`);
}

async function finishInstallJob(
  targetName: InstallTarget,
  target: (typeof INSTALL_TARGETS)[InstallTarget],
  job: InstallJob,
  {
    code,
    signal,
    launchError,
  }: { code: number | null; signal: NodeJS.Signals | null; launchError?: unknown },
  npmLease?: NpmInstallLease,
) {
  if (job.status !== "running") {
    npmLease?.release();
    return;
  }
  try {
    if (launchError) {
      appendOutput(job, `${installStartErrorMessage(launchError)}\n`);
    }

    const priorError = launchError
      ? installStartErrorMessage(launchError)
      : job.error;
    const shouldVerifyOpenCovenTool =
      !priorError && code === 0 && isOpenCovenToolInstallTarget(targetName);
    let verification: OpenCovenToolVerification | undefined;
    let verificationError: string | null = null;
    let installed: CommandPathResult;

    if (shouldVerifyOpenCovenTool) {
      try {
        verification = await verifyOpenCovenToolInstall(targetName);
        installed = { path: verification.path };
        let resolutionHint: string | null = null;
        if (!isVerifiedOpenCovenInstallSuccess(code, verification)) {
          // npm succeeded but PATH still resolves something that fails
          // verification — usually a stale launcher shadowing the fresh
          // npm-prefix copy. Try the identity-gated cleanup so the Update
          // button can actually resolve that state instead of reporting it
          // forever; when cleanup is unsafe, surface its manual hint.
          const resolution = await resolveStaleOpenCovenLaunchers(
            targetName,
            verification.latest,
          );
          for (const line of resolution.log) appendOutput(job, `${line}\n`);
          resolutionHint = resolution.hint;
          if (resolution.verification) {
            verification = resolution.verification;
            installed = { path: verification.path };
          }
        }
        if (!isVerifiedOpenCovenInstallSuccess(code, verification)) {
          verificationError = [
            verification.error ?? `Could not verify ${target.binary} after install.`,
            resolutionHint,
          ]
            .filter(Boolean)
            .join(" ");
        }
      } catch {
        installed = { path: null };
        verificationError =
          `Could not complete ${target.binary} post-install verification. Re-check the tool and retry.`;
      }
    } else {
      installed = await commandPath(
        target.binary,
        targetName === "coven-cli" ? { refresh: true } : undefined,
      );
    }

    const installError = shouldVerifyOpenCovenTool
      ? verificationError
      : installerOutcomeError(
          targetName,
          target,
          code,
          signal,
          installed,
          job.output,
          priorError,
        );
    const installOk = verification
      ? isVerifiedOpenCovenInstallSuccess(code, verification)
      : !installError && code === 0 && !!installed.path;

    // Hermes has no positional prompt slot, so the harness's `-- "<prompt>"`
    // convention needs the hermes-coven shim to remap it onto -q. This remains
    // best-effort: a shim failure never turns an otherwise successful install
    // into a failed tool update.
    if (installOk && targetName === "hermes" && installed.path) {
      try {
        const shim = await installHermesShim(installed.path);
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

    const recovered = await recoverDaemonAfterCliInstall(targetName, job);
    const recoveryError = !recovered
      ? job.daemon?.detail ?? "local daemon recovery failed"
      : null;

    job.status = "done";
    job.finishedAt = Date.now();
    if (installOk && targetName === "coven-cli") invalidateOpenCovenToolUpdateCache();
    job.ok = installOk && recovered;
    job.code = code;
    job.binaryPath = installed.path;
    if (verification) job.verification = verification;
    if (!job.ok) {
      job.error = [installError, recoveryError].filter(Boolean).join(" ");
    } else {
      delete job.error;
    }
  } catch (err) {
    job.status = "done";
    job.finishedAt = Date.now();
    job.ok = false;
    job.code = code;
    job.error = installStartErrorMessage(err);
    appendOutput(job, `${job.error}\n`);
  } finally {
    job.cancel = undefined;
    npmLease?.release();
  }
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
  let finalized = false;

  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    if (forceFinishTimer) clearTimeout(forceFinishTimer);
  };
  const finish = async (
    code: number | null,
    signal: NodeJS.Signals | null,
    launchError?: unknown,
  ) => {
    if (finalized) return;
    finalized = true;
    clearTimers();
    await finishInstallJob(
      targetName,
      target,
      job,
      { code, signal, launchError },
      npmLease,
    );
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
      () => void finish(null, null, new Error(job.error ?? reason)),
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
    const readyForInstall = await prepareForInstall(targetName, job);

    if (job.cancelRequested) {
      await finish(null, null, new Error("install cancelled"));
      return;
    }

    if (!readyForInstall) {
      finalized = true;
      clearTimers();
      const safeMessage =
        "Cave could not safely stop the local daemon before updating the CLI. The update was not started.";
      finishInstallJobError(
        job,
        new Error(job.daemon?.detail ?? safeMessage),
        npmLease,
        safeMessage,
      );
      return;
    }

    child = spawn(plan.command, plan.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: covenSpawnEnv(),
      shell: plan.shell,
    });
    child.stdout?.on("data", (d) => appendOutput(job, d.toString()));
    child.stderr?.on("data", (d) => appendOutput(job, d.toString()));
    timer = setTimeout(() => {
      job.error = `install timed out after ${target.timeoutMs / 1000}s`;
      requestTermination(`${job.error}; stopping installer...`);
    }, target.timeoutMs);
    child.on("error", (err) => void finish(null, null, err));
    child.on("close", (code, signal) => void finish(code, signal));
  } catch (err) {
    await finish(null, null, err);
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
        hint: "Retry in a moment. If it keeps happening, quit stuck terminal/session processes and try again.",
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
