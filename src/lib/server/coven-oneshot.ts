// One-shot Coven CLI invocations: send a prompt, collect stdout, return it.
//
// Extracted from src/app/api/board/enrich-steps/route.ts, where it lived as a
// private `runCoven`. A second caller (the reader's Rewrite control) needed the
// same thing, and a copy would be a second place for the abort/settle handling
// to drift.
//
// This is for work that is NOT a chat turn: the caller wants text back, not a
// session in the transcript. Callers that want a real turn should go through
// the normal send path instead.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import { covenLaunchCommand } from "@/lib/coven-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { familiarWorkspace } from "@/lib/coven-paths";

/** A familiar id safe to pass as a CLI argument. */
const SAFE_ID = /^[a-z0-9_-]+$/i;

/**
 * The familiar's workspace directory, when it exists — the cwd a one-shot run
 * should use so relative paths in its prompt resolve the way the familiar's own
 * runs do. Undefined for an unknown id or a path that is not a directory; the
 * caller then falls back to the server's cwd.
 */
export async function resolveFamiliarWorkspace(
  familiarId: string,
): Promise<string | undefined> {
  if (!SAFE_ID.test(familiarId)) return undefined;
  const candidate = await familiarWorkspace(familiarId);
  try {
    const entry = await stat(candidate);
    return entry.isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run the Coven CLI and resolve with everything it wrote to stdout.
 *
 * Never rejects: a spawn failure resolves with whatever was collected (usually
 * ""), because every caller here treats "no usable output" and "the process
 * died" the same way — fall back to what they already had. Aborting the signal
 * SIGTERMs the child and resolves with the partial output.
 */
export function runCovenOneShot(
  args: readonly string[],
  signal: AbortSignal,
  cwd?: string,
  familiarId?: string,
): Promise<string> {
  return new Promise((resolve) => {
    try {
      let out = "";
      let settled = false;
      const { command, fixedArgs } = covenLaunchCommand();
      const child = spawn(command, [...fixedArgs, ...args], {
        windowsHide: true,
        cwd: cwd ?? process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: harnessSpawnEnv(familiarId),
      });

      const finish = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(out);
      };
      const onAbort = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* the child is already gone */
        }
      };

      if (signal.aborted) onAbort();
      signal.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (d: Buffer) => {
        out += d.toString("utf8");
      });
      child.stderr.on("data", () => {
        /* stderr is progress chatter, not the answer */
      });
      child.on("error", finish);
      child.on("close", finish);
    } catch {
      resolve("");
    }
  });
}
