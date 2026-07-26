import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

/**
 * Shared native-chat runtime availability contract (#3856).
 *
 * The chat send route spawns one of five local launch vehicles directly:
 * `coven run` (the default for codex/claude/…), or the copilot / grok /
 * hermes / opencode CLIs. "Available" here means one thing only: the EXACT
 * command the route is about to hand to `spawn()`, resolved inside the EXACT
 * environment that spawn will receive, points at a real launchable file.
 *
 * The evaluation is bounded and passive — filesystem metadata and permission
 * checks only. It never spawns a process, never prompts, and never touches the
 * user's message, so it is safe to run before every chat turn.
 * Authentication/provider health is deliberately out of scope: a runner that
 * launches but is signed out is "ready" here and must fail through its own
 * real output.
 */

export type DirectRunnerId = "coven" | "copilot" | "grok" | "hermes" | "opencode";

export type RuntimeAvailabilityState =
  | "ready"
  | "missing"
  | "unlaunchable"
  | "probe_failed"
  | "unsupported_runtime";

export const RUNTIME_AVAILABILITY_ERROR_CODES = {
  missing: "runtime_missing",
  unlaunchable: "runtime_unlaunchable",
  probe_failed: "runtime_probe_failed",
  unsupported_runtime: "runtime_unsupported",
} as const;

export type RuntimeAvailabilityErrorCode =
  (typeof RUNTIME_AVAILABILITY_ERROR_CODES)[keyof typeof RUNTIME_AVAILABILITY_ERROR_CODES];

export type RuntimeAvailability =
  | {
      state: "ready";
      runner: DirectRunnerId;
      /** Where the spawn command resolved. Diagnostic only — the spawn keeps
       * using the original command so resolution and launch cannot drift. */
      resolvedPath: string;
    }
  | {
      state: Exclude<RuntimeAvailabilityState, "ready">;
      runner: DirectRunnerId;
      code: RuntimeAvailabilityErrorCode;
      message: string;
    };

/** Wire-safe shape for status surfaces: state plus remediation copy, without
 * the resolved local filesystem path. */
export type RuntimeAvailabilitySummary =
  | { state: "ready" }
  | {
      state: Exclude<RuntimeAvailabilityState, "ready">;
      code: RuntimeAvailabilityErrorCode;
      message: string;
    };

export function summarizeRuntimeAvailability(
  availability: RuntimeAvailability,
): RuntimeAvailabilitySummary {
  if (availability.state === "ready") return { state: "ready" };
  return {
    state: availability.state,
    code: availability.code,
    message: availability.message,
  };
}

/** Legacy injectable seam for filesystem simulations. The production probe
 * uses richer candidate inspection so POSIX execute permissions are checked. */
export type StatFileFn = (candidate: string) => boolean;

export type RuntimeAvailabilityProbe = {
  runner: DirectRunnerId;
  /** The exact executable that will be passed to `spawn()`. */
  command: string;
  /** The exact environment object the spawn will receive. */
  env: Record<string, string | undefined>;
  /** Coven/Grok launch resolution found a Windows shim it could not safely
   * convert into a runnable command (`CovenLaunchCommand.unresolvedWindowsShim`). */
  unresolvedWindowsShim?: boolean;
  /** OpenCode on Windows launches through a PowerShell host whose script
   * invokes this inner command; PowerShell resolves it via PATHEXT. */
  powerShellHostedCommand?: string;
  platform?: NodeJS.Platform;
  statFile?: StatFileFn;
};

// The missing-runner remediation copy is shared with the post-spawn ENOENT
// race handler in the send route so the two failure paths can never drift.
// The Coven line is additionally pinned by the chat client, which shows its
// "Open Setup" recovery when the message matches /Coven CLI not found on
// PATH/i (src/components/chat-view.test.ts).
const MISSING_RUNNER_MESSAGES: Record<DirectRunnerId, string> = {
  coven: "Coven CLI not found on PATH. Open Setup to install it, then try again.",
  copilot:
    "copilot CLI not found on PATH. Install it with `npm install -g @github/copilot`, then try again.",
  grok: "Grok Build CLI not found on PATH. Install Grok Build, sign in with `grok`, then try again.",
  hermes: "Hermes CLI not found on PATH. Install Hermes, then try again.",
  opencode:
    "OpenCode CLI not found on PATH. Install it with `npm install -g opencode-ai`, then try again.",
};

const RUNTIME_LAUNCH_FAILED_MESSAGES: Record<DirectRunnerId, string> = {
  coven: "Coven CLI failed to start. Check its installation and try again.",
  copilot: "copilot CLI failed to start. Check its installation and try again.",
  grok: "Grok Build CLI failed to start. Check its installation and try again.",
  hermes: "Hermes CLI failed to start. Check its installation and try again.",
  opencode: "OpenCode CLI failed to start. Check its installation and try again.",
};

const RUNNER_LABELS: Record<DirectRunnerId, string> = {
  coven: "Coven CLI",
  copilot: "copilot CLI",
  grok: "Grok Build CLI",
  hermes: "Hermes CLI",
  opencode: "OpenCode CLI",
};

export function missingRunnerMessage(runner: DirectRunnerId): string {
  return MISSING_RUNNER_MESSAGES[runner];
}

export function runtimeLaunchFailedMessage(runner: DirectRunnerId): string {
  return RUNTIME_LAUNCH_FAILED_MESSAGES[runner];
}

export function localRuntimeLaunchError(
  runner: DirectRunnerId,
  errorCode: string | undefined,
): {
  code: "runtime_missing" | "runtime_launch_failed";
  message: string;
} {
  return errorCode === "ENOENT"
    ? { code: "runtime_missing", message: missingRunnerMessage(runner) }
    : {
        code: "runtime_launch_failed",
        message: runtimeLaunchFailedMessage(runner),
      };
}

type CandidateInspection = "launchable" | "missing" | "unlaunchable";

type CommandResolution =
  | { state: "launchable"; resolvedPath: string }
  | { state: "missing" | "unlaunchable" };

type InspectCandidateFn = (candidate: string) => CandidateInspection;

function isMissingCandidateError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function defaultInspectCandidate(
  candidate: string,
  platform: NodeJS.Platform,
): CandidateInspection {
  try {
    if (!statSync(candidate).isFile()) return "unlaunchable";
  } catch (error) {
    if (isMissingCandidateError(error)) return "missing";
    throw error;
  }
  if (platform !== "win32") {
    try {
      accessSync(candidate, constants.X_OK);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EACCES" || code === "EPERM") return "unlaunchable";
      if (isMissingCandidateError(error)) return "missing";
      throw error;
    }
  }
  return "launchable";
}

function inspectWithStatFile(candidate: string, statFile: StatFileFn): CandidateInspection {
  return statFile(candidate) ? "launchable" : "missing";
}

function pathEntries(env: Record<string, string | undefined>, platform: NodeJS.Platform): string[] {
  const raw = env.PATH ?? env.Path ?? env.path ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  // Cap the walk so a pathological PATH cannot turn the per-turn gate into
  // unbounded filesystem work.
  return raw
    .split(delimiter)
    .filter(Boolean)
    .slice(0, 512);
}

/** Candidate filenames a bare `spawn(name)` can actually launch. Windows'
 * CreateProcess only appends/starts native executables — a `.cmd`/`.bat`
 * npm shim is real on disk yet unlaunchable through a direct spawn. */
function spawnCandidates(name: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [name];
  if (path.win32.extname(name)) return [name];
  return [`${name}.exe`, `${name}.com`];
}

/** Candidate filenames PowerShell (PATHEXT semantics) can invoke. */
function pathExtCandidates(name: string, env: Record<string, string | undefined>): string[] {
  if (path.win32.extname(name)) return [name];
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const candidates = new Set<string>();
  for (const ext of exts) {
    candidates.add(`${name}${ext}`);
    // Windows filesystems are case-insensitive; the POSIX filesystems the
    // test-suite simulates win32 on are not.
    candidates.add(`${name}${ext.toLowerCase()}`);
  }
  return [...candidates];
}

/** Candidate filenames that prove a runner IS installed even though this
 * direct spawn cannot start it. A bare name diagnoses its PATHEXT shims; an
 * explicit native-executable name (`hermes.exe`) also diagnoses sibling
 * shims of its base name (`hermes.cmd`) — a `.cmd`-only install behind an
 * `.exe` spawn is unlaunchable, not missing. */
function shimOnlyCandidates(name: string, env: Record<string, string | undefined>): string[] {
  const ext = path.win32.extname(name);
  if (!ext) return pathExtCandidates(name, env);
  if (!/^\.(exe|com)$/i.test(ext)) return [name];
  return pathExtCandidates(name.slice(0, -ext.length), env);
}

function isPathLike(command: string, platform: NodeJS.Platform): boolean {
  if (command.includes("/")) return true;
  if (platform === "win32" && (command.includes("\\") || /^[A-Za-z]:/.test(command))) {
    return true;
  }
  return false;
}

function resolveCommand(
  command: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  inspectCandidate: InspectCandidateFn,
  candidatesFor: (name: string) => string[],
): CommandResolution {
  let sawUnlaunchable = false;
  const inspect = (candidate: string): CommandResolution | null => {
    const inspection = inspectCandidate(candidate);
    if (inspection === "launchable") return { state: "launchable", resolvedPath: candidate };
    if (inspection === "unlaunchable") sawUnlaunchable = true;
    return null;
  };

  if (isPathLike(command, platform)) {
    // Launch plans only ever produce absolute path-like commands (discovered
    // binaries, process.execPath, the PowerShell host). Inspect them as given.
    for (const candidate of candidatesFor(command)) {
      const resolved = inspect(candidate);
      if (resolved) return resolved;
    }
    return { state: sawUnlaunchable ? "unlaunchable" : "missing" };
  }
  const joiner = platform === "win32" ? path.win32 : path.posix;
  for (const dir of pathEntries(env, platform)) {
    for (const candidate of candidatesFor(command)) {
      const full = joiner.join(dir, candidate);
      const resolved = inspect(full);
      if (resolved) return resolved;
    }
  }
  return { state: sawUnlaunchable ? "unlaunchable" : "missing" };
}

function notReady(
  runner: DirectRunnerId,
  state: Exclude<RuntimeAvailabilityState, "ready">,
  message: string,
): RuntimeAvailability {
  return { state, runner, code: RUNTIME_AVAILABILITY_ERROR_CODES[state], message };
}

function unlaunchableRunnerMessage(runner: DirectRunnerId): string {
  return `${RUNNER_LABELS[runner]} was found but is not executable. Restore executable permissions or reinstall it, then try again.`;
}

/**
 * Classify whether the exact spawn this probe describes can start.
 *
 * - `ready`      — the spawn command resolves to a real file in the spawn env.
 * - `missing`    — nothing resolves anywhere the spawn would look.
 * - `unlaunchable` — something was found, but this launch method cannot run
 *   it (unconverted Windows shim, `.cmd`-only install behind a direct spawn,
 *   or a missing PowerShell host for OpenCode on Windows).
 * - `probe_failed` — the check itself failed (e.g. EACCES statting a PATH
 *   entry); deliberately NOT reported as "not installed".
 */
export function evaluateRuntimeAvailability(
  probe: RuntimeAvailabilityProbe,
): RuntimeAvailability {
  const { runner, command, env } = probe;
  const platform = probe.platform ?? process.platform;
  const inspectCandidate: InspectCandidateFn = probe.statFile
    ? (candidate) => inspectWithStatFile(candidate, probe.statFile!)
    : (candidate) => defaultInspectCandidate(candidate, platform);
  const label = RUNNER_LABELS[runner];
  try {
    if (probe.unresolvedWindowsShim) {
      return notReady(
        runner,
        "unlaunchable",
        `${label} was found as a Windows launcher shim that cannot be converted into a directly runnable command. Reinstall it so a native executable is on PATH, then try again.`,
      );
    }
    const resolved = resolveCommand(command, env, platform, inspectCandidate, (name) =>
      spawnCandidates(name, platform),
    );
    if (resolved.state !== "launchable") {
      if (probe.powerShellHostedCommand !== undefined) {
        // The outer command for a hosted launch is the PowerShell host
        // itself; its absence is a broken launch vehicle, not a missing
        // runner install.
        return notReady(
          runner,
          "unlaunchable",
          `Windows PowerShell was not found at its system location, so ${label} cannot be launched. Restore Windows PowerShell, then try again.`,
        );
      }
      if (resolved.state === "unlaunchable") {
        return notReady(runner, "unlaunchable", unlaunchableRunnerMessage(runner));
      }
      if (platform === "win32") {
        const shimOnly = resolveCommand(command, env, platform, inspectCandidate, (name) =>
          shimOnlyCandidates(name, env),
        );
        if (shimOnly.state === "launchable") {
          return notReady(
            runner,
            "unlaunchable",
            `${label} is installed as a Windows command shim that a direct launch cannot run. Reinstall it so a native executable is on PATH, then try again.`,
          );
        }
      }
      return notReady(runner, "missing", missingRunnerMessage(runner));
    }
    if (probe.powerShellHostedCommand !== undefined) {
      const inner = resolveCommand(
        probe.powerShellHostedCommand,
        env,
        platform,
        inspectCandidate,
        (name) => pathExtCandidates(name, env),
      );
      if (inner.state === "unlaunchable") {
        return notReady(runner, "unlaunchable", unlaunchableRunnerMessage(runner));
      }
      if (inner.state === "missing") {
        return notReady(runner, "missing", missingRunnerMessage(runner));
      }
    }
    return { state: "ready", runner, resolvedPath: resolved.resolvedPath };
  } catch {
    // Keep the message value-free: stat errors embed local filesystem paths,
    // and OpenCode diagnostics in particular must never surface them.
    return notReady(
      runner,
      "probe_failed",
      `Could not verify the ${label} launch command before starting it, so this turn was not run. Check file permissions on its install location, then try again.`,
    );
  }
}
