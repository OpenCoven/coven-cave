import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { parseRuntimeClientVersion } from "../copilot-stream.ts";
import { copilotLaunchCommandForBinary } from "../copilot-bin.ts";

export type CopilotCapabilityProbe = {
  version: string | null;
  /** Only safe, non-payload diagnostic metadata; never command output. */
  diagnostic?: "version-unavailable" | "version-unparseable" | "probe-timeout";
};

type ProbeCacheEntry = { value: CopilotCapabilityProbe; expiresAt: number };
const cache = new Map<string, ProbeCacheEntry>();
const CACHE_MS = 5 * 60_000;
const TIMEOUT_MS = 2_500;

/**
 * A command name is not a stable runtime identity: a global npm upgrade can
 * replace its shim target without changing `copilot` itself. Include the
 * resolved file metadata in the short-lived cache key so a changed binary is
 * probed before it can select an old JSONL schema.
 */
async function binaryIdentity(executable: string): Promise<string> {
  const pathValue = process.env.PATH ?? "";
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

async function identityBeforeDeadline(executable: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      binaryIdentity(executable),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
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
    spawnImpl?: typeof spawn;
    binaryIdentity?: (executable: string) => Promise<string>;
  } = {},
): Promise<CopilotCapabilityProbe> {
  const now = options.now ?? Date.now;
  const startedAt = Date.now();
  const identity = options.binaryIdentity
    ? await options.binaryIdentity(executable)
    : await identityBeforeDeadline(executable);
  if (!identity) return { version: null, diagnostic: "probe-timeout" };
  const cacheKey = `${executable}\u0000${identity}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) return cached.value;
  const childSpawn = options.spawnImpl ?? spawn;
  const value = await new Promise<CopilotCapabilityProbe>((resolve) => {
    let stdout = "";
    let settled = false;
    const settle = (result: CopilotCapabilityProbe) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      const launch = copilotLaunchCommandForBinary(executable);
      if (launch.unresolvedWindowsShim) {
        settle({ version: null, diagnostic: "version-unavailable" });
        return;
      }
      child = childSpawn(launch.command, [...launch.fixedArgs, "--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
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
    }, Math.max(1, TIMEOUT_MS - (Date.now() - startedAt)));
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
  cache.set(cacheKey, { value, expiresAt: now() + CACHE_MS });
  return value;
}

/** Test seam: clear only process-local, non-persistent probe data. */
export function clearCopilotCapabilityProbeCache(): void {
  cache.clear();
}
