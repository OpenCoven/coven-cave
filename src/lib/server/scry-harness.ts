/**
 * Running a scry on a local harness.
 *
 * A scry needs a harness, a model, and an image path — and deliberately **no
 * familiar**. `/api/chat/send` requires a `familiarId` because it resolves the
 * harness, model, and workspace from that familiar's binding; a scry has none
 * of that to resolve, and requiring one would make the rite unreachable on the
 * first run it exists for. `harnessSpawnEnv(null)` is the documented shape for
 * exactly this case: shared, unscoped keys only, no familiar-scoped vault
 * secret anywhere near a process reading an arbitrary uploaded picture.
 *
 * **Which harnesses may be scried on.** This app models one vision-adjacent
 * capability — "can this harness open a local image file" — which is the gate
 * `/api/chat/send` calls `imagesSupported`. It is not a model-modality
 * database, and inventing one here would be a guess dressed as a capability.
 * So the allowlist is `SUMMONABLE_LOCAL_HARNESS_IDS`: the runtimes the
 * summoning rite already offers for a local vessel. A harness the rite cannot
 * summon a familiar onto is not one it should be scrying with, and OpenClaw —
 * a separate agent vessel that the chat route's own image gate excludes — is
 * outside that set for the same reason in both places.
 *
 * The harness is launched through `coven run <harness> -- <instruction>` with
 * its working directory set to the staging root, so the staged likeness is
 * simply a file in the process's own cwd. No capability-gated flag is passed:
 * a scry is one bounded question, and `--stream-json` / `--add-dir` /
 * `--permission` all depend on `--help` probes the send route performs and this
 * one has no reason to.
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { covenLaunchCommand, covenWrapperSpawnEnv } from "../coven-bin.ts";
import { harnessSpawnEnv } from "../harness-spawn-env.ts";
import { isScryCapableHarness } from "../scry.ts";
import { BoundedProcessOutput, terminateProcessTree } from "../process-execution.ts";

/** Output budget for one reading. A JSON object is small; banners are not. */
const SCRY_OUTPUT_BUDGET_BYTES = 128 * 1024;

/** A scry that has not answered by now is not going to. */
export const SCRY_TIMEOUT_MS = 120_000;

export type ScrySpawn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean },
) => ChildProcess;

export type ScryRunResult =
  | { ok: true; output: string }
  | { ok: false; error: string; status: number };

/**
 * Spawn the harness and collect its reply.
 *
 * `spawn` is injectable so the suite can prove the launch contract, the
 * timeout, and the failure mapping without a harness installed and without
 * making a single model call.
 */
export async function runScry(options: {
  harness: string;
  instruction: string;
  likenessPath: string;
  spawn?: ScrySpawn;
  timeoutMs?: number;
}): Promise<ScryRunResult> {
  if (!isScryCapableHarness(options.harness)) {
    return { ok: false, error: "that runtime cannot scry a likeness", status: 400 };
  }

  let launch;
  try {
    launch = covenLaunchCommand();
  } catch {
    launch = null;
  }
  if (!launch || launch.resolutionTimedOut || launch.unresolvedWindowsShim) {
    return {
      ok: false,
      error: "Coven is not available on this host, so nothing can read the likeness.",
      status: 503,
    };
  }

  const env = covenWrapperSpawnEnv(harnessSpawnEnv(null));
  const args = [
    ...launch.fixedArgs,
    "run",
    options.harness,
    "--",
    options.instruction,
  ];
  const cwd = path.dirname(options.likenessPath);
  const spawn = options.spawn ?? ((command, spawnArgs, spawnOptions) =>
    nodeSpawn(command, spawnArgs, { ...spawnOptions, stdio: ["ignore", "pipe", "pipe"] }));

  let child: ChildProcess;
  try {
    child = spawn(launch.command, args, { cwd, env, windowsHide: true });
  } catch {
    return { ok: false, error: "could not start the runtime", status: 503 };
  }

  const output = new BoundedProcessOutput(SCRY_OUTPUT_BUDGET_BYTES);
  return await new Promise<ScryRunResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (result: ScryRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout?.on("data", (chunk) => output.append(chunk));
    child.stderr?.on("data", (chunk) => output.append(chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).then(() =>
        finish({ ok: false, error: "the scry timed out", status: 504 }),
      );
    }, options.timeoutMs ?? SCRY_TIMEOUT_MS);
    child.on("error", () =>
      finish({ ok: false, error: "the runtime could not be started", status: 503 }),
    );
    child.on("close", () => {
      if (timedOut) return;
      // A non-zero exit is not on its own a failure: harnesses routinely exit
      // non-zero after printing a perfectly good answer. The parser is the
      // authority on whether a reading came back, so the text is returned
      // either way and the route reports "nothing readable" if it is empty.
      finish({ ok: true, output: output.text() });
    });
  });
}
