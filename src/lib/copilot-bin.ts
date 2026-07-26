// Spawn-safe, asynchronous launcher resolution for the Copilot CLI.
//
// Windows npm installs expose `copilot.cmd`. We parse that reviewed shim into
// `node <entry.js>` rather than using a shell, so prompts remain argv data.
// Resolution is deliberately asynchronous and performed by the bounded
// capability probe; direct chat/flow launch reuses the resolved command.

import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { covenLaunchCommandForBinary, pickWindowsLauncher, type CovenLaunchCommand } from "./coven-bin.ts";

const MAX_WINDOWS_WHERE_OUTPUT = 64 * 1024;

async function withinTimeout<T>(work: Promise<T>, timeoutMs: number, fallback: T): Promise<{ value: T; timedOut: boolean }> {
  if (timeoutMs <= 0) return { value: fallback, timedOut: true };
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work.then((value) => ({ value, timedOut: false })),
      new Promise<{ value: T; timedOut: boolean }>((resolve) => {
        timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pathCopilotLauncher(binary: string, env?: NodeJS.ProcessEnv): Promise<string> {
  if (isAbsolute(binary)) return binary;
  for (const directory of (env?.PATH ?? "").split(delimiter).filter(Boolean)) {
    try {
      const candidate = await realpath(join(directory, binary));
      const metadata = await stat(candidate);
      // Match execvp semantics: a directory or non-executable file earlier
      // in PATH must not hide a usable Copilot launcher later in PATH.
      if (metadata.isFile() && (metadata.mode & 0o111) !== 0) return candidate;
    } catch {
      // Keep searching PATH; a later entry may be the executable launcher.
    }
  }
  return binary;
}

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
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      if (output.length + text.length > MAX_WINDOWS_WHERE_OUTPUT) {
        try { child.kill("SIGTERM"); } catch { /* best effort */ }
        clearTimeout(timer);
        settle(binary);
        return;
      }
      output += text;
    });
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
  const timeoutMs = options.timeoutMs ?? 1_500;
  const resolveLauncher = platform === "win32"
    ? windowsCopilotLauncher(binary, timeoutMs, options.env)
    : pathCopilotLauncher(binary, options.env);
  const resolved = await withinTimeout(
    resolveLauncher,
    timeoutMs,
    binary,
  );
  return {
    ...covenLaunchCommandForBinary(resolved.value, platform),
    ...(resolved.timedOut ? { resolutionTimedOut: true as const } : {}),
  };
}
