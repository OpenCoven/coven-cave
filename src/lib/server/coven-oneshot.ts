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
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { bindingFor, loadConfig } from "@/lib/cave-config";
import { covenLaunchCommand, covenWrapperSpawnEnv } from "@/lib/coven-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { familiarWorkspacesRoot, readFamiliarWorkspaces } from "@/lib/coven-paths";
import { launchModelArg, prepareLocalCodexLaunch, withLaunchModel } from "@/lib/server/local-codex-launch";

/** A familiar id safe to pass as a CLI argument. */
const SAFE_ID = /^[a-z0-9_-]+$/i;

/** The real path of `target` when it is a directory, else undefined. */
async function realDirectory(target: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(target);
    return (await stat(resolved)).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The familiar's workspace directory, when it exists — the cwd a one-shot run
 * should use so relative paths in its prompt resolve the way the familiar's own
 * runs do. Undefined for an unknown id or a path that is not a directory; the
 * caller then falls back to the server's cwd.
 *
 * The id arrives in request bodies, so the result is always a real path
 * (#6374): the workspace the owner declared in familiars.toml, or a directory
 * whose real path stays inside the real familiars root. A symlink out of the
 * root, or a root reached through an alias such as macOS /tmp ->
 * /private/tmp, cannot hand the spawned run a cwd elsewhere.
 */
export async function resolveFamiliarWorkspace(
  familiarId: string,
): Promise<string | undefined> {
  if (!SAFE_ID.test(familiarId)) return undefined;
  const root = await realDirectory(familiarWorkspacesRoot());
  if (!root) return undefined;

  const declared = (await readFamiliarWorkspaces()).get(familiarId);
  if (declared) {
    const resolvedDeclared = await realDirectory(declared);
    if (resolvedDeclared) {
      const relativeDeclared = path.relative(root, resolvedDeclared);
      if (relativeDeclared !== "" && !relativeDeclared.startsWith("..") && !path.isAbsolute(relativeDeclared)) {
        return resolvedDeclared;
      }
    }
  }

  const candidate = await realDirectory(path.join(/* turbopackIgnore: true */ root, familiarId));
  if (!candidate) return undefined;
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return candidate;
}

type OneShotLaunch = {
  args: readonly string[];
  applyEnv?: (env: Record<string, string | undefined>) => void;
};

/**
 * A `coven run codex-ollama|codex-lmstudio` launch gets the checks a chat
 * turn gets (#6049): the server answers, the model is installed and can call
 * tools, and Codex receives that model and this computer's server. Callers
 * that pass no `--model` run the familiar's saved one. Null when the launch
 * can't run locally; the reason is logged, since callers only see no output.
 */
async function prepareOneShotLaunch(args: readonly string[], familiarId?: string): Promise<OneShotLaunch | null> {
  if (args[0] !== "run" || !args[1]) return { args };
  const requested = launchModelArg(args)
    ?? (familiarId && SAFE_ID.test(familiarId) ? bindingFor(await loadConfig(), familiarId).model ?? null : null);
  const local = await prepareLocalCodexLaunch(args[1], requested, "coven");
  if (!local.local) return { args };
  if (!local.ok) {
    console.warn(`[coven-oneshot] ${args[1]} launch refused (${local.code}): ${local.message}`);
    return null;
  }
  return { args: withLaunchModel(args, local.nativeModel), applyEnv: local.applyEnv };
}

/**
 * Run the Coven CLI and resolve with everything it wrote to stdout.
 *
 * Never rejects: a spawn failure resolves with whatever was collected (usually
 * ""), because every caller here treats "no usable output" and "the process
 * died" the same way — fall back to what they already had. Aborting the signal
 * SIGTERMs the child and resolves with the partial output.
 */
export async function runCovenOneShot(
  args: readonly string[],
  signal: AbortSignal,
  cwd?: string,
  familiarId?: string,
): Promise<string> {
  let launch: OneShotLaunch | null;
  try {
    launch = await prepareOneShotLaunch(args, familiarId);
  } catch {
    launch = null;
  }
  if (!launch || signal.aborted) return "";
  return spawnOneShot(launch, signal, cwd, familiarId);
}

function spawnOneShot(
  launch: OneShotLaunch,
  signal: AbortSignal,
  cwd?: string,
  familiarId?: string,
): Promise<string> {
  return new Promise((resolve) => {
    try {
      let out = "";
      let settled = false;
      const { command, fixedArgs } = covenLaunchCommand();
      const env = covenWrapperSpawnEnv(harnessSpawnEnv(familiarId));
      launch.applyEnv?.(env);
      const child = spawn(command, [...fixedArgs, ...launch.args], {
        windowsHide: true,
        cwd: cwd ?? process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env,
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
