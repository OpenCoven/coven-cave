import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { openCodeLaunch, openCodeSpawnEnv, writeOpenCodeLaunchInput } from "@/lib/opencode-bin";
import { parseOpenCodeModels } from "@/lib/opencode-models";
import type { RuntimeModelOption } from "@/lib/runtime-models";

const MODEL_LIST_TIMEOUT_MS = 8_000;

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
      const launch = openCodeLaunch(["models"]);
      const child = spawn(launch.command, launch.args, {
        // Match the chat spawn's vault scope. A provider key can be granted to
        // one familiar only, and listing its authenticated OpenCode models must
        // not silently drop that key by using the unscoped probe environment.
        env: openCodeSpawnEnv(familiarId),
        stdio: launch.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
      writeOpenCodeLaunchInput(child, launch);
      child.stdout.on("data", (chunk) => (output += chunk.toString()));
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
