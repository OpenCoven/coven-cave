import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { grokBin, grokLaunchCommandForBinary } from "@/lib/grok-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { parseGrokModels, type RuntimeModelOption } from "@/lib/grok-build";

const MODEL_LIST_TIMEOUT_MS = 2_500;

/** Bounded, credential-scoped Grok Build model discovery for shared clients. */
export function listGrokModels(
  familiarId?: string | null,
  dependencies: {
    spawnImpl?: typeof spawn;
    timeoutMs?: number;
    binary?: () => string;
    env?: (familiarId?: string | null) => NodeJS.ProcessEnv;
  } = {},
): Promise<RuntimeModelOption[]> {
  return new Promise((resolve) => {
    const launch = grokLaunchCommandForBinary((dependencies.binary ?? grokBin)());
    const env = (dependencies.env ?? harnessSpawnEnv)(familiarId);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = (dependencies.spawnImpl ?? spawn)(launch.command, [...launch.fixedArgs, "--no-auto-update", "models"], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolve([]);
      return;
    }
    let output = "";
    let settled = false;
    const done = (models: RuntimeModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(models);
    };
    child.stdout.on("data", (data) => (output += data.toString()));
    child.stderr.on("data", (data) => (output += data.toString()));
    const timeout = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* discovery stays unavailable */ }
      done([]);
    }, dependencies.timeoutMs ?? MODEL_LIST_TIMEOUT_MS);
    child.once("close", () => done(parseGrokModels(output).models));
    child.once("error", () => done([]));
  });
}
