import { NextResponse } from "next/server";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  globalNpmInstallOwner,
  releaseGlobalNpmInstall,
  reserveGlobalNpmInstall,
  type NpmInstallLease,
} from "@/lib/server/global-npm-install-lane";
import {
  covenBin,
  caveToolSpawnEnv,
  covenSpawnEnv,
  pickWindowsLauncher,
  refreshCovenBin,
  refreshCovenSpawnEnv,
} from "@/lib/coven-bin";
import {
  verifyOpenCovenToolInstall,
  npmLaunchCommandForPath,
  type OpenCovenToolVerification,
} from "@/lib/opencoven-tools-status";
import { invalidateOpenCovenToolUpdateCache } from "@/lib/opencoven-tools-update-cache";
import { isVerifiedOpenCovenInstallSuccess } from "@/lib/opencoven-tool-verification";
import { resolveStaleOpenCovenLaunchers } from "@/lib/opencoven-tools-resolve";
import { callDaemonTarget, localDaemonTarget } from "@/lib/coven-daemon";
import { startLocalDaemon } from "@/lib/daemon-start";
import {
  markDaemonCliInstalling,
  daemonUpdateTraceLine,
  prepareDaemonForCliUpdate,
  recoverDaemonAfterCliUpdate,
  type DaemonCommandResult,
  type DaemonUpdateDependencies,
  type DaemonUpdateLifecycle,
} from "@/lib/daemon-update-lifecycle";
import {
  appendOutput,
  appendTrace,
  installJobTail,
  type InstallJobOutput,
} from "./install-job-output";
import { runInstallProcess } from "./install-process";
import { prerequisiteById, type PrerequisiteId } from "@/lib/onboarding-prerequisites";
import {
  installManagedNodeToolchain,
  managedNpmLaunch,
  probeManagedNodeToolchain,
} from "@/lib/server/managed-node-toolchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

function reviewedPackage(id: Extract<PrerequisiteId, "runtime-codex" | "runtime-claude" | "runtime-copilot" | "runtime-openclaw">): string {
  const install = prerequisiteById(id).install;
  if (install.kind !== "managed-npm") throw new Error(`${id} must use the managed npm manifest lane`);
  return `${install.package.packageName}@${install.package.version}`;
}

/**
 * Shared one-click dependency install service for onboarding routes.
 *
 * Hard allowlist: the request names a TARGET, never a command. Every target
 * maps to a fixed install mechanism so nothing user-controlled ever reaches
 * a shell:
 *
 *   - kind "managed-node": Cave-owned, exact Node/npm archive installation
 *   - Coven CLI self-update: fixed global install of the package's latest tag
 *                            through npm beside the detected CLI.
 *   - other kind "npm":      pinned package through Cave-managed Node/npm.
 */
const INSTALL_TARGETS = {
  "managed-node": {
    kind: "managed-node",
    label: "Coven-managed Node.js and npm",
    binary: "node",
    timeoutMs: 300_000,
  },
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
    packageName: reviewedPackage("runtime-codex"),
    binary: "codex",
    timeoutMs: 240_000,
  },
  claude: {
    kind: "npm",
    label: "Claude Code",
    packageName: reviewedPackage("runtime-claude"),
    binary: "claude",
    timeoutMs: 240_000,
  },
  copilot: {
    kind: "npm",
    label: "Copilot",
    packageName: reviewedPackage("runtime-copilot"),
    binary: "copilot",
    timeoutMs: 240_000,
  },
  openclaw: {
    kind: "npm",
    label: "OpenClaw",
    packageName: reviewedPackage("runtime-openclaw"),
    binary: "openclaw",
    timeoutMs: 240_000,
  },
} as const;

export type OnboardingInstallTarget = keyof typeof INSTALL_TARGETS;
type InstallTarget = OnboardingInstallTarget;
type CommandPathResult = { path: string | null; error?: string };

function isOpenCovenToolInstallTarget(
  target: InstallTarget,
): target is "coven-cli" {
  return target === "coven-cli";
}

function managedNodeInstallHint(): string {
  return "Install Cave-managed Node.js and npm first. Cave keeps this toolchain in its user data and does not modify your system PATH.";
}

async function commandPath(
  binary: string,
  opts: { refresh?: boolean; refreshOnMiss?: boolean } = {},
): Promise<CommandPathResult> {
  const finder = process.platform === "win32" ? "where" : "which";
  const find = async (env: NodeJS.ProcessEnv) => {
    try {
      const { stdout } = await execFileAsync(finder, [binary], {
        windowsHide: true,
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

type SpawnPlan = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  shell: boolean;
  verificationPath?: string;
  /** Sanitized, path-free facts retained independently from npm output. */
  traceLines: string[];
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function npmBesideDetectedCoven(detected: string): { npmPath: string; prefix: string } | null {
  const binDir = path.dirname(detected);
  const names = process.platform === "win32" ? ["npm.cmd", "npm.exe", "npm"] : ["npm"];
  // `binDir` is the global npm bin on the HOST machine, discovered at runtime.
  // Without the ignore, Turbopack reads `path.join(binDir, "npm")` as a module
  // specifier it must resolve, globs the checkout root for it, and drags the
  // whole project into the standalone NFT bundle.
  const npmPath = names
    .map((name) => path.join(/* turbopackIgnore: true */ binDir, name))
    .find((candidate) => existsSync(/* turbopackIgnore: true */ candidate));
  if (!npmPath) return null;
  return {
    npmPath,
    prefix: process.platform === "win32" ? binDir : path.dirname(binDir),
  };
}

/**
 * A global npm bin commonly contains `coven.cmd` but not `npm.cmd` on
 * Windows: npm itself lives beside node.exe while its configured global prefix
 * is user-scoped. Prefer a colocated launcher when one exists, then resolve a
 * host npm from the refreshed environment while retaining the detected CLI's
 * prefix. This keeps the update in the same verified global installation
 * without falsely asking a healthy CLI to be reinstalled.
 */
async function npmForDetectedCoven(detected: string): Promise<{ npmPath: string; prefix: string } | null> {
  const adjacent = npmBesideDetectedCoven(detected);
  if (adjacent) return adjacent;
  const resolved = await commandPath("npm", { refresh: true, refreshOnMiss: true });
  if (!resolved.path || !path.isAbsolute(resolved.path)) return null;
  return {
    npmPath: resolved.path,
    prefix: process.platform === "win32" ? path.dirname(detected) : path.dirname(path.dirname(detected)),
  };
}

function hostNpmSpawnEnv(npmPath: string, prefix: string): NodeJS.ProcessEnv {
  const env = caveToolSpawnEnv();
  for (const key of Object.keys(env)) {
    if (/^npm_/i.test(key)) delete env[key];
  }
  env.PATH = [path.dirname(npmPath), env.PATH].filter(Boolean).join(path.delimiter);
  env.NPM_CONFIG_LOGLEVEL = "error";
  env.NPM_CONFIG_PREFIX = prefix;
  env.npm_config_prefix = prefix;
  return env;
}

/** Resolve a fixed spawn plan. Only the Coven CLI self-update follows the
 * detected global npm installation; prerequisite tools stay on the reviewed,
 * pinned Cave-managed toolchain. */
async function spawnPlanFor(
  targetName: InstallTarget,
  target: (typeof INSTALL_TARGETS)[InstallTarget],
): Promise<
  | SpawnPlan
  | { managedNodeMissing: true }
  | { npmMissing: true }
  | null
> {
  if (target.kind === "npm") {
    if (targetName === "coven-cli") {
      const detected = covenBin();
      if (path.isAbsolute(detected)) {
        const npm = await npmForDetectedCoven(detected);
        if (!npm) return { npmMissing: true };
        const launch = npmLaunchCommandForPath(npm.npmPath);
        if (!launch) return { npmMissing: true };
        return {
          command: launch.command,
          args: [...launch.fixedArgs, "install", "--global", target.packageName],
          env: hostNpmSpawnEnv(npm.npmPath, npm.prefix),
          shell: false,
          verificationPath: detected,
          traceLines: [
            "npm discovery: verified host npm for the detected Coven CLI prefix.",
            "Installer launch: host npm with fixed argv; shell disabled.",
          ],
        };
      }
    }

    const managed = await probeManagedNodeToolchain();
    if (managed.status !== "ready") return { managedNodeMissing: true };
    const launch = managedNpmLaunch(managed.paths);
    if (!launch) return { managedNodeMissing: true };

    return {
      command: launch.command,
      args: [...launch.args, "install", "--global", target.packageName],
      env: covenSpawnEnv(),
      shell: false,
      traceLines: [
        "Managed Node/npm probe: ready in Cave user data.",
        "Installer launch: managed npm-cli.js via Node with fixed argv; shell disabled.",
      ],
    };
  }
  return null;
}

type InstallJob = {
  status: "running" | "done";
  kind: "managed-node" | "npm";
  startedAt: number;
  finishedAt?: number;
  /** Raw interleaved stdout+stderr, capped to OUTPUT_CAP. */
  output: string;
  /** Sanitized lifecycle facts that must survive a long raw-output tail. */
  trace: string[];
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
} & InstallJobOutput;

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
 * final reservation has to be atomic across managed-toolchain and npm work.
 */
function activeNpmInstallTarget(): InstallTarget | null {
  const owner = globalNpmInstallOwner();
  if (!owner || !isInstallTarget(owner)) return null;
  const job = jobs.get(owner);
  if (job?.status === "running" && (job.kind === "npm" || job.kind === "managed-node")) return owner;
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

type OnboardingInstallServiceResult = {
  status: number;
  body: Record<string, unknown>;
};

function npmBusyResult(owner: InstallTarget): OnboardingInstallServiceResult {
  return {
    status: 409,
    body: {
      ok: false,
      retryable: true,
      code: "npm_install_in_progress",
      error: `${INSTALL_TARGETS[owner].label} is using Cave's shared managed toolchain. Wait for it to finish, then retry.`,
      ...npmLaneView(),
    },
  };
}

function releaseNpmLease(job: InstallJob, npmLease?: NpmInstallLease) {
  if (!npmLease) return;
  npmLease.release();
  appendTrace(job, "Managed toolchain/install lane: released.");
}

function verificationTraceLine(verification: OpenCovenToolVerification): string {
  const yesNo = (value: boolean | null) =>
    value === null ? "unknown" : value ? "yes" : "no";
  return (
    "Post-install verification: " +
    `package=${yesNo(verification.packageVerified)}; ` +
    `executable=${yesNo(verification.executableVerified)}; ` +
    `compatible=${yesNo(verification.compatible)}; ` +
    `latest=${yesNo(verification.latestSatisfied)}.`
  );
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
      const pid = health.data?.daemon?.pid;
      return {
        ok: reachable,
        // Read-only supervisor-restart evidence; never signalled.
        ...(reachable && typeof pid === "number" ? { pid } : {}),
        ...(reachable
          ? {}
          : { detail: health.error ?? (health.ok ? "daemon reported unhealthy" : `daemon http ${health.status}`) }),
      };
    },
    stop: async (): Promise<DaemonCommandResult> => {
      const stop = await runInstallProcess(covenBin(), ["daemon", "stop"], {
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
      // Every non-success result from startLocalDaemon has a stable, redacted
      // error code/message. Do not fall back to raw launcher output here.
      return { ok: false, detail: started.error };
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
  if (/(EACCES|EPERM|EROFS|permission denied)/i.test(output)) {
    return "Cave could not write to its user-scoped npm prefix. Check that your Cave application-data directory is writable, then retry; Cave will not request elevation.";
  }
  return null;
}

function jobView(job: InstallJob) {
  const tail = installJobTail(job);
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

export function readOnboardingInstall(
  target: OnboardingInstallTarget,
): Record<string, unknown> {
  const job = jobs.get(target);
  if (!job) return { status: "idle", ...npmLaneView() };
  return { ...jobView(job), ...npmLaneView() };
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
  releaseNpmLease(job, npmLease);
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
  plan: SpawnPlan,
  job: InstallJob,
  {
    code,
    signal,
    launchError,
  }: { code: number | null; signal: NodeJS.Signals | null; launchError?: unknown },
  npmLease?: NpmInstallLease,
) {
  if (job.status !== "running") {
    releaseNpmLease(job, npmLease);
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
        verification = await verifyOpenCovenToolInstall(targetName, {
          binaryPath: plan.verificationPath,
          env: plan.env,
        });
        installed = { path: verification.path };
        let resolutionHint: string | null = null;
        if (
          !plan.verificationPath &&
          !isVerifiedOpenCovenInstallSuccess(code, verification)
        ) {
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
    if (isOpenCovenToolInstallTarget(targetName)) {
      appendTrace(
        job,
        verification
          ? verificationTraceLine(verification)
          : "Post-install verification: skipped because the installer did not succeed.",
      );
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
    releaseNpmLease(job, npmLease);
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
    appendTrace(
      job,
      launchError
        ? "Installer process: did not start."
        : code === null
          ? `Installer process: ended by signal ${signal ?? "unknown"}.`
          : `Installer process: exited with code ${code}.`,
    );
    await finishInstallJob(
      targetName,
      target,
      plan,
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
      appendTrace(job, "Installer process: not started because daemon preparation failed.");
      appendTrace(job, "Post-install verification: skipped because the installer did not start.");
      finishInstallJobError(
        job,
        new Error(job.daemon?.detail ?? safeMessage),
        npmLease,
        safeMessage,
      );
      return;
    }

    child = spawn(plan.command, plan.args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: plan.env,
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

async function runManagedNodeInstallJob(job: InstallJob, npmLease?: NpmInstallLease) {
  const controller = new AbortController();
  job.cancel = () => {
    if (job.status !== "running" || job.cancelRequested) return;
    job.cancelRequested = true;
    job.error = "install cancelled";
    appendOutput(job, "Cancellation requested; stopping managed Node download...\n");
    controller.abort();
  };
  try {
    appendTrace(job, "Managed Node installer: starting verified user-scoped toolchain setup.");
    const result = await installManagedNodeToolchain({
      signal: controller.signal,
      onProgress: (line) => appendOutput(job, `${line}\n`),
    });
    if (result.status === "ready" && !job.cancelRequested) {
      refreshCovenBin();
      refreshCovenSpawnEnv();
      job.ok = true;
      job.code = 0;
      job.binaryPath = result.paths.node;
      appendTrace(job, "Managed Node installer: digest-verified toolchain re-probed successfully.");
    } else {
      job.ok = false;
      job.code = 1;
      job.error = job.cancelRequested
        ? "install cancelled"
        : result.status === "unusable"
          ? result.detail
          : "Managed Node.js and npm could not be verified after installation.";
      appendOutput(job, `${job.error}\n`);
    }
  } catch (error) {
    job.ok = false;
    job.code = 1;
    job.error = job.cancelRequested
      ? "install cancelled"
      : installStartErrorMessage(error);
    appendOutput(job, `${job.error}\n`);
  } finally {
    job.status = "done";
    job.finishedAt = Date.now();
    job.cancel = undefined;
    releaseNpmLease(job, npmLease);
  }
}

export async function startOnboardingInstall(
  targetName: OnboardingInstallTarget,
): Promise<OnboardingInstallServiceResult> {
  const target = INSTALL_TARGETS[targetName];

  // Idempotent re-start: the bootstrap runner and the legacy installer UI may
  // both observe the same reviewed job. They must attach, never double-spawn.
  const existing = jobs.get(targetName);
  if (existing?.status === "running") {
    return { status: 200, body: jobView(existing) };
  }

  if (target.kind === "npm" || target.kind === "managed-node") {
    const activeTarget = activeNpmInstallTarget();
    if (activeTarget) return npmBusyResult(activeTarget);
  }

  if (target.kind === "managed-node") {
    const reservation = reserveGlobalNpmInstall(targetName);
    if (!reservation.ok) {
      const owner = isInstallTarget(reservation.owner) ? reservation.owner : targetName;
      return npmBusyResult(owner);
    }
    const job: InstallJob = {
      status: "running",
      kind: target.kind,
      startedAt: Date.now(),
      output: "",
      trace: [],
    };
    appendTrace(job, "Managed toolchain/install lane: reserved for this installer.");
    jobs.set(targetName, job);
    void runManagedNodeInstallJob(job, reservation.lease);
    return {
      status: 202,
      body: { started: true, target: targetName, ...npmLaneView() },
    };
  }

  const plan = await spawnPlanFor(targetName, target);
  if (plan && "npmMissing" in plan) {
    return {
      status: 422,
      body: {
        ok: false,
        npmMissing: true,
        error: "npm is not available beside the detected Coven CLI",
        hint: "Reinstall Coven CLI with Node.js and npm, restart Cave, then retry the update.",
      },
    };
  }
  if (plan && "managedNodeMissing" in plan) {
    return {
      status: 422,
      body: {
        ok: false,
        managedNodeMissing: true,
        error: "Cave-managed Node.js and npm are not ready",
        hint: managedNodeInstallHint(),
      },
    };
  }
  if (!plan) {
    return {
      status: 500,
      body: { ok: false, error: "no install plan for this platform" },
    };
  }

  const recheck = jobs.get(targetName);
  if (recheck?.status === "running") {
    return { status: 200, body: jobView(recheck) };
  }

  const reservation =
    target.kind === "npm" ? reserveGlobalNpmInstall(targetName) : null;
  if (reservation && !reservation.ok) {
    const owner = isInstallTarget(reservation.owner)
      ? reservation.owner
      : targetName;
    return npmBusyResult(owner);
  }
  const npmLease = reservation?.ok ? reservation.lease : undefined;

  const job: InstallJob = {
    status: "running",
    kind: target.kind,
    startedAt: Date.now(),
    output: "",
    trace: [],
  };
  for (const line of plan.traceLines) appendTrace(job, line);
  if (npmLease) appendTrace(job, "Managed toolchain/install lane: reserved for this installer.");
  jobs.set(targetName, job);

  void runInstallJob(targetName, target, plan, job, npmLease);

  return {
    status: 202,
    body: { started: true, target: targetName, ...npmLaneView() },
  };
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

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
  return NextResponse.json(readOnboardingInstall(target));
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

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
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  let body: { target?: unknown; confirmInstall?: unknown };
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
  if (body.confirmInstall !== true) {
    return NextResponse.json(
      { ok: false, error: "explicit install confirmation required" },
      { status: 400 },
    );
  }
  const result = await startOnboardingInstall(body.target);
  return NextResponse.json(result.body, {
    status: result.status,
    ...(result.status === 409 ? { headers: { "Retry-After": "2" } } : {}),
  });
}
