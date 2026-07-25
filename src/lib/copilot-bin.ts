// Spawn-safe, asynchronous launcher resolution for the Copilot CLI.
//
// Windows npm installs expose `copilot.cmd`. We parse that reviewed shim into
// `node <entry.js>` rather than using a shell, so prompts remain argv data.
// Resolution is deliberately asynchronous and performed by the bounded
// capability probe; direct chat/flow launch reuses the resolved command.

import { spawn } from "node:child_process";
import { covenLaunchCommandForBinary, pickWindowsLauncher, type CovenLaunchCommand } from "./coven-bin.ts";

async function windowsCopilotLauncher(binary: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<string> {
  if (/\.(?:cmd|bat|exe|com)$/i.test(binary)) return binary;
  return await new Promise<string>((resolve) => {
    let settled = false;
    const settle = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let output = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("where", [binary], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env });
    } catch {
      settle(binary);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* best effort */ }
      settle(binary);
    }, Math.max(1, timeoutMs));
    timer.unref?.();
    child.stdout?.on("data", (chunk: Buffer | string) => { output += String(chunk); });
    child.once("error", () => {
      clearTimeout(timer);
      settle(binary);
    });
    child.once("close", () => {
      clearTimeout(timer);
      settle(pickWindowsLauncher(output.split(/\r?\n/)) ?? binary);
    });
  });
}

/** Resolve a direct spawn command for a native binary or npm Windows shim. */
export async function resolveCopilotLaunchCommand(
  binary: string,
  options: { platform?: NodeJS.Platform; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CovenLaunchCommand> {
  const platform = options.platform ?? process.platform;
  const launcher = platform === "win32"
    ? await windowsCopilotLauncher(binary, options.timeoutMs ?? 1_500, options.env)
    : binary;
  return covenLaunchCommandForBinary(launcher, platform);
}
