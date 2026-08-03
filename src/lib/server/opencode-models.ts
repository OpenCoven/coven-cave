import { spawn } from "node:child_process";
import {
  openCodeAvailabilityProbe,
  openCodeLaunch,
  openCodeSpawnEnv,
} from "@/lib/opencode-bin";
import { parseOpenCodeModels } from "@/lib/opencode-models";
import { evaluateRuntimeAvailability } from "@/lib/runtime-availability";
import type { RuntimeModelOption } from "@/lib/runtime-models";

const MODEL_LIST_TIMEOUT_MS = 8_000;
export const MAX_MODEL_LIST_OUTPUT_BYTES = 512 * 1024;

/** Keep an authenticated CLI inventory from turning a bounded API request
 * into an unbounded in-memory read. Return null when the next chunk exceeds
 * the response budget. */
export function appendBoundedModelOutput(current: string, chunk: string): string | null {
  const next = current + chunk;
  return Buffer.byteLength(next, "utf8") <= MAX_MODEL_LIST_OUTPUT_BYTES ? next : null;
}

/** Read only the authenticated local OpenCode model inventory; never refresh it. */
export function listOpenCodeModels(familiarId?: string | null): Promise<RuntimeModelOption[]> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const done = (models: RuntimeModelOption[]) => {
      if (settled) return;
      settled = true;
      resolve(models);
    };
    try {
      const env = openCodeSpawnEnv(familiarId);
      const launch = openCodeLaunch(["models"], process.platform, env);
      if (evaluateRuntimeAvailability(openCodeAvailabilityProbe(launch, env)).state !== "ready") {
        done([]);
        return;
      }
      const child = spawn(launch.command, launch.args, {
        // Match the chat spawn's vault scope. A provider key can be granted to
        // one familiar only, and listing its authenticated OpenCode models must
        // not silently drop that key by using the unscoped probe environment.
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        const next = appendBoundedModelOutput(output, chunk.toString());
        if (next === null) {
          try { child.kill("SIGTERM"); } catch { /* inventory stays unavailable */ }
          done([]);
          return;
        }
        output = next;
      });
      const timeout = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* inventory stays unavailable */ }
        done([]);
      }, MODEL_LIST_TIMEOUT_MS);
      child.on("close", (code) => {
        clearTimeout(timeout);
        done(code === 0 ? parseOpenCodeModels(output) : []);
      });
      child.on("error", () => {
        clearTimeout(timeout);
        done([]);
      });
    } catch {
      done([]);
    }
  });
}
