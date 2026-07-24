import { spawn } from "node:child_process";
import { parseRuntimeClientVersion } from "../copilot-stream.ts";

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
 * Probe only `copilot --version`, cache the normalized result briefly, and
 * deliberately discard stdout/stderr.  This is the runtime-version boundary
 * for schema selection: no version means no direct JSONL parser guess.
 */
export async function probeCopilotCapability(
  executable = "copilot",
  options: { now?: () => number; spawnImpl?: typeof spawn } = {},
): Promise<CopilotCapabilityProbe> {
  const now = options.now ?? Date.now;
  const cached = cache.get(executable);
  if (cached && cached.expiresAt > now()) return cached.value;
  const childSpawn = options.spawnImpl ?? spawn;
  const value = await new Promise<CopilotCapabilityProbe>((resolve) => {
    let output = "";
    let settled = false;
    const settle = (result: CopilotCapabilityProbe) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = childSpawn(executable, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      settle({ version: null, diagnostic: "version-unavailable" });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Best effort; the result is still fail-closed.
      }
      settle({ version: null, diagnostic: "probe-timeout" });
    }, TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (output.length < 4_096) output += String(chunk).slice(0, 4_096 - output.length);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (output.length < 4_096) output += String(chunk).slice(0, 4_096 - output.length);
    });
    child.once("error", () => {
      clearTimeout(timer);
      settle({ version: null, diagnostic: "version-unavailable" });
    });
    child.once("close", () => {
      clearTimeout(timer);
      const version = parseRuntimeClientVersion(output);
      settle(version ? { version } : { version: null, diagnostic: "version-unparseable" });
    });
  });
  cache.set(executable, { value, expiresAt: now() + CACHE_MS });
  return value;
}

/** Test seam: clear only process-local, non-persistent probe data. */
export function clearCopilotCapabilityProbeCache(): void {
  cache.clear();
}
