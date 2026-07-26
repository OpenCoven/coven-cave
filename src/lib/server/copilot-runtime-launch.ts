import { resolveCopilotLaunchCommand } from "../copilot-bin.ts";
import { canonicalProbeSpawnEnv } from "../harness-spawn-env.ts";
import {
  evaluateRuntimeAvailability,
  RUNTIME_AVAILABILITY_ERROR_CODES,
  type RuntimeAvailability,
} from "../runtime-availability.ts";

const COPILOT_LAUNCH_RESOLUTION_TIMEOUT_MS = 2_500;

const COPILOT_LAUNCH_TIMEOUT_MESSAGE =
  "The Copilot launch check timed out before Cave could verify the CLI. Retry after Copilot finishes starting.";
const COPILOT_LAUNCH_PROBE_FAILED_MESSAGE =
  "Could not verify the copilot CLI launch command before starting it, so this turn was not run. Check file permissions on its install location, then try again.";

export type CopilotRuntimeLaunch = {
  /** Exact credential-free environment used for resolution and availability. */
  env: NodeJS.ProcessEnv;
  /** Exact command and fixed argv prefix selected by launcher resolution. */
  command: string;
  fixedArgs: string[];
  /** Absolute deadline shared by env, launcher, and identity discovery. */
  deadline: number;
  availability: RuntimeAvailability;
  /** Safe timeout marker retained for capability diagnostics. */
  resolutionTimedOut?: true;
  /** Preserve a failed Windows shim conversion without ever executing it. */
  unresolvedWindowsShim?: true;
};

export type ResolveCopilotRuntimeLaunchOptions = {
  platform?: NodeJS.Platform;
  now?: () => number;
  /** Test seam; production uses canonicalProbeSpawnEnv(). */
  spawnEnv?: (discoveryDeadline: number) => NodeJS.ProcessEnv;
  /** Test seam for bounded launcher resolution. */
  resolveLaunchCommand?: typeof resolveCopilotLaunchCommand;
  /** Test seam for simulating platform-specific filesystem availability. */
  evaluateAvailability?: typeof evaluateRuntimeAvailability;
};

export function copilotLaunchProbeFailureAvailability(
  reason: "timeout" | "failed",
): RuntimeAvailability {
  return {
    state: "probe_failed",
    runner: "copilot",
    code: RUNTIME_AVAILABILITY_ERROR_CODES.probe_failed,
    message:
      reason === "timeout"
        ? COPILOT_LAUNCH_TIMEOUT_MESSAGE
        : COPILOT_LAUNCH_PROBE_FAILED_MESSAGE,
  };
}

function failedPlan(input: {
  executable: string;
  env: NodeJS.ProcessEnv;
  deadline: number;
  reason: "timeout" | "failed";
  command?: string;
  fixedArgs?: string[];
}): CopilotRuntimeLaunch {
  return {
    env: input.env,
    command: input.command ?? input.executable,
    fixedArgs: input.fixedArgs ?? [],
    deadline: input.deadline,
    availability: copilotLaunchProbeFailureAvailability(input.reason),
    ...(input.reason === "timeout" ? { resolutionTimedOut: true as const } : {}),
  };
}

/**
 * Resolve and passively classify one exact Copilot launch plan.
 *
 * This boundary never runs Copilot. Environment construction, npm-shim
 * conversion, and filesystem availability all share one absolute deadline;
 * callers may run `--version` only after this returns `ready`, using the exact
 * command/fixed args and env returned here.
 */
export async function resolveCopilotRuntimeLaunch(
  executable = "copilot",
  options: ResolveCopilotRuntimeLaunchOptions = {},
): Promise<CopilotRuntimeLaunch> {
  const now = options.now ?? Date.now;
  const discoveryDeadline = now() + COPILOT_LAUNCH_RESOLUTION_TIMEOUT_MS;
  let env: NodeJS.ProcessEnv;
  try {
    env = options.spawnEnv
      ? options.spawnEnv(discoveryDeadline)
      : canonicalProbeSpawnEnv({ discoveryDeadline, now });
  } catch {
    return failedPlan({
      executable,
      env: { NODE_ENV: process.env.NODE_ENV ?? "development" },
      deadline: discoveryDeadline,
      reason: "failed",
    });
  }

  if (now() >= discoveryDeadline) {
    return failedPlan({
      executable,
      env,
      deadline: discoveryDeadline,
      reason: "timeout",
    });
  }

  const remaining = discoveryDeadline - now();
  if (remaining <= 0) {
    return failedPlan({
      executable,
      env,
      deadline: discoveryDeadline,
      reason: "timeout",
    });
  }
  let launch: Awaited<ReturnType<typeof resolveCopilotLaunchCommand>>;
  try {
    launch = await (options.resolveLaunchCommand ?? resolveCopilotLaunchCommand)(
      executable,
      {
        platform: options.platform,
        timeoutMs: remaining,
        env,
      },
    );
  } catch {
    return failedPlan({
      executable,
      env,
      deadline: discoveryDeadline,
      reason: "failed",
    });
  }

  if (launch.resolutionTimedOut || now() >= discoveryDeadline) {
    return failedPlan({
      executable,
      env,
      deadline: discoveryDeadline,
      reason: "timeout",
      command: launch.command,
      fixedArgs: launch.fixedArgs,
    });
  }

  const availability = (
    options.evaluateAvailability ?? evaluateRuntimeAvailability
  )({
    runner: "copilot",
    command: launch.command,
    env,
    unresolvedWindowsShim: launch.unresolvedWindowsShim === true,
    platform: options.platform,
  });
  if (now() >= discoveryDeadline) {
    return failedPlan({
      executable,
      env,
      deadline: discoveryDeadline,
      reason: "timeout",
      command: launch.command,
      fixedArgs: launch.fixedArgs,
    });
  }
  return {
    env,
    command: launch.command,
    fixedArgs: launch.fixedArgs,
    deadline: discoveryDeadline,
    availability,
    ...(launch.unresolvedWindowsShim
      ? { unresolvedWindowsShim: true as const }
      : {}),
  };
}
