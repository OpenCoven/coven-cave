import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { grokBin, grokLaunchCommandForBinary } from "@/lib/grok-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { parseGrokModels, type RuntimeModelOption } from "@/lib/grok-build";

const MODEL_LIST_TIMEOUT_MS = 2_500;
const MAX_MODEL_LIST_OUTPUT_BYTES = 64 * 1024;

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
    let child: ChildProcessByStdio<null, Readable, Readable>;
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
    const capture = (data: Buffer | string) => {
      if (settled) return;
      const chunk = String(data);
      if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > MAX_MODEL_LIST_OUTPUT_BYTES) {
        try { child.kill("SIGTERM"); } catch { /* unavailable */ }
        done([]);
        return;
      }
      output += chunk;
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timeout = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* discovery stays unavailable */ }
      done([]);
    }, dependencies.timeoutMs ?? MODEL_LIST_TIMEOUT_MS);
    // A CLI can print a parseable partial catalog and still exit non-zero
    // (authentication, provider, or command errors). Treat that as failed
    // discovery; otherwise the shared resolver would label the partial output
    // as live entitlement.
    child.once("close", (code) => done(code === 0 ? parseGrokModels(output).models : []));
    child.once("error", () => done([]));
  });
}
