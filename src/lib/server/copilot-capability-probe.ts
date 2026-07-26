import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import {
  COPILOT_NO_AUTO_UPDATE_ARG,
  parseRuntimeClientVersion,
} from "../copilot-stream.ts";
import { type CovenLaunchCommand } from "../coven-bin.ts";
import { vaultFreeDiscoveryEnv } from "../child-spawn-env.ts";
import type { RuntimeAvailability } from "../runtime-availability.ts";
import { loadVaultMap } from "../vault.ts";
import {
  copilotLaunchProbeFailureAvailability,
  resolveCopilotRuntimeLaunch,
  type ResolveCopilotRuntimeLaunchOptions,
} from "./copilot-runtime-launch.ts";

export type CopilotCapabilityDiagnostic =
  | "version-unavailable"
  | "version-unparseable"
  | "probe-timeout";

export type CopilotCapabilityProbe = {
  version: string | null;
  /** Exact spawn target resolved during this bounded probe, never request argv. */
  launchCommand?: Pick<CovenLaunchCommand, "command" | "fixedArgs">;
  /** Passive classification of the exact launch plan used by this probe. */
  availability: RuntimeAvailability;
  /** Only safe, non-payload diagnostic metadata; never command output. */
  diagnostic?: CopilotCapabilityDiagnostic;
};

type ProbeCacheEntry = {
  value: CopilotCapabilityProbe;
  expiresAt: number;
  identity: string;
};
const cache = new Map<string, ProbeCacheEntry>();
const CACHE_MS = 5 * 60_000;
// Copilot's npm/native loader can take tens of seconds to page in after an
// install or update before `--version` emits. Keep launcher discovery short,
// but give a successfully resolved version process its own bounded budget.
const VERSION_PROCESS_TIMEOUT_MS = 30_000;

const VERSION_UNAVAILABLE_MESSAGE =
  "Cave could not read the Copilot CLI version. Run `copilot --version`, then try again.";
const VERSION_UNPARSEABLE_MESSAGE =
  "Copilot returned an unrecognized version. Update Copilot or the Cave runtime schema, then try again.";
const VERSION_TIMEOUT_MESSAGE =
  "The Copilot version check timed out. Retry after Copilot finishes starting.";

/**
 * Map only capability-probe failures. A parsed version returns null so each
 * caller can retain its context-specific unsupported-schema copy.
 */
export function copilotCapabilityFailureMessage(
  capability:
    | {
        version?: string | null;
        diagnostic?: CopilotCapabilityDiagnostic;
        availability?: RuntimeAvailability;
      }
    | null
    | undefined,
): string | null {
  if (capability?.availability && capability.availability.state !== "ready") {
    return capability.availability.message;
  }
  if (capability?.diagnostic === "version-unparseable") {
    return VERSION_UNPARSEABLE_MESSAGE;
  }
  if (capability?.diagnostic === "probe-timeout") {
    return VERSION_TIMEOUT_MESSAGE;
  }
  if (capability?.diagnostic === "version-unavailable" || !capability?.version) {
    return VERSION_UNAVAILABLE_MESSAGE;
  }
  return null;
}

/**
 * Capability discovery has no familiar context and must never execute an
 * arbitrary PATH launcher with shared or vault-managed credentials. Resolve
 * through the same canonical PATH as the eventual harness spawn, then remove
 * every vault-managed key before launching the untrusted runtime.
 */
function probeSpawnEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return vaultFreeDiscoveryEnv(baseEnv, loadVaultMap(true));
}

/**
 * A command name is not a stable runtime identity: a global npm upgrade can
 * replace its shim target without changing `copilot` itself. Include the
 * resolved file metadata in the short-lived cache key so a changed binary is
 * probed before it can select an old JSONL schema.
 */
async function binaryIdentity(executable: string, env: NodeJS.ProcessEnv): Promise<string> {
  const pathValue = env.PATH ?? "";
  const extensions = process.platform === "win32"
    ? ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")]
    : [""];
  const candidates = isAbsolute(executable)
    ? [executable]
    : pathValue.split(delimiter).filter(Boolean).flatMap((directory) =>
      extensions.map((extension) => join(directory, `${executable}${extension}`)),
    );
  for (const candidate of candidates) {
    try {
      const [resolved, metadata] = await Promise.all([realpath(candidate), stat(candidate)]);
      return `${resolved}:${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    } catch {
      // Keep looking: PATH can contain missing, protected, or stale entries.
    }
  }
  // PATH remains part of the unresolved identity so a PATH change still
  // invalidates the negative cache entry.
  return `unresolved:${executable}:${pathValue}`;
}

async function launchIdentity(launch: CovenLaunchCommand, env: NodeJS.ProcessEnv): Promise<string> {
  const targets = [launch.command, ...launch.fixedArgs.filter((arg) => isAbsolute(arg))];
  return (await Promise.all(targets.map((target) => binaryIdentity(target, env)))).join("\u0000");
}

async function identityBeforeDeadline(
  work: () => Promise<string>,
  deadline: number,
  now: () => number,
): Promise<string | null> {
  const remaining = deadline - now();
  if (remaining <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), remaining);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probe only `copilot --version`, cache the normalized result briefly, and
 * deliberately discard stdout/stderr.  This is the runtime-version boundary
 * for schema selection: no version means no direct JSONL parser guess.
 */
export async function probeCopilotCapability(
  executable = "copilot",
  options: {
    now?: () => number;
    platform?: NodeJS.Platform;
    spawnImpl?: typeof spawn;
    binaryIdentity?: (executable: string) => Promise<string>;
    /** Test seam; production defaults to the exact Cave harness PATH. */
    spawnEnv?: (discoveryDeadline: number) => NodeJS.ProcessEnv;
    /** Test seam for proving deadline exhaustion stops launcher resolution. */
    resolveLaunchCommand?: ResolveCopilotRuntimeLaunchOptions["resolveLaunchCommand"];
    /** Test seam for blocked exact launch plans. */
    resolveRuntimeLaunch?: typeof resolveCopilotRuntimeLaunch;
  } = {},
): Promise<CopilotCapabilityProbe> {
  const now = options.now ?? Date.now;
  // A cold Finder/Spotlight launch may synchronously recover the user's login
  // PATH. That work shares the same short resolution budget as launcher and
  // identity discovery, and its subprocesses receive only a vault-free env.
  let launch: Awaited<ReturnType<typeof resolveCopilotRuntimeLaunch>>;
  try {
    launch = await (options.resolveRuntimeLaunch ?? resolveCopilotRuntimeLaunch)(
      executable,
      {
        now,
        platform: options.platform,
        resolveLaunchCommand: options.resolveLaunchCommand,
        ...(options.spawnEnv
          ? {
              spawnEnv: (discoveryDeadline) =>
                probeSpawnEnv(options.spawnEnv!(discoveryDeadline)),
            }
          : {}),
      },
    );
  } catch {
    return {
      version: null,
      availability: copilotLaunchProbeFailureAvailability("failed"),
    };
  }
  if (launch.availability.state !== "ready") {
    return {
      version: null,
      availability: launch.availability,
      ...(launch.resolutionTimedOut
        ? { diagnostic: "probe-timeout" as const }
        : {}),
    };
  }

  const launchCommand = {
    command: launch.command,
    fixedArgs: launch.fixedArgs,
  };
  // Cache by command name plus canonical PATH, then validate the exact current
  // command/script metadata. A changed npm target is re-probed immediately.
  const cacheKey = `${executable}\u0000${
    launch.env.PATH ?? launch.env.Path ?? launch.env.path ?? ""
  }`;
  const cached = cache.get(cacheKey);
  const identity = await identityBeforeDeadline(
    options.binaryIdentity
      ? () => options.binaryIdentity!(launch.command)
      : () => launchIdentity(launchCommand, launch.env),
    launch.deadline,
    now,
  );
  if (identity === null || now() >= launch.deadline) {
    return {
      version: null,
      availability: copilotLaunchProbeFailureAvailability("timeout"),
      diagnostic: "probe-timeout",
    };
  }
  if (
    cached &&
    cached.value.version &&
    cached.expiresAt > now() &&
    identity === cached.identity
  ) {
    return {
      ...cached.value,
      availability: launch.availability,
      launchCommand,
    };
  }

  const childSpawn = options.spawnImpl ?? spawn;
  const value = await new Promise<
    Pick<CopilotCapabilityProbe, "version" | "diagnostic">
  >((resolve) => {
    let stdout = "";
    let settled = false;
    const settle = (
      result: Pick<CopilotCapabilityProbe, "version" | "diagnostic">,
    ) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = childSpawn(
        launch.command,
        [...launch.fixedArgs, COPILOT_NO_AUTO_UPDATE_ARG, "--version"],
        {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: launch.env,
        },
      );
    } catch {
      settle({ version: null, diagnostic: "version-unavailable" });
      return;
    }
    let forceKill: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Best effort; the result is still fail-closed.
      }
      forceKill = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }, 250);
      forceKill.unref?.();
      settle({ version: null, diagnostic: "probe-timeout" });
    }, VERSION_PROCESS_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < 4_096) stdout += String(chunk).slice(0, 4_096 - stdout.length);
    });
    // Drain stderr so a broken launcher cannot block on a full pipe; it is
    // deliberately never parsed as a version or surfaced to the user.
    child.stderr?.resume();
    child.once("error", () => {
      clearTimeout(timer);
      settle({ version: null, diagnostic: "version-unavailable" });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (forceKill) clearTimeout(forceKill);
      if (code !== 0) {
        settle({ version: null, diagnostic: "version-unavailable" });
        return;
      }
      const version = parseRuntimeClientVersion(stdout);
      settle(version ? { version } : { version: null, diagnostic: "version-unparseable" });
    });
  });
  const result: CopilotCapabilityProbe = {
    ...value,
    availability: launch.availability,
    launchCommand,
  };
  // Only a parsed version is stable enough to cache. Spawn/nonzero/timeout and
  // unparseable output are transient and must be retried on the next request.
  if (result.version) {
    cache.set(cacheKey, { value: result, expiresAt: now() + CACHE_MS, identity });
  }
  return result;
}

/** Test seam: clear only process-local, non-persistent probe data. */
export function clearCopilotCapabilityProbeCache(): void {
  cache.clear();
}
