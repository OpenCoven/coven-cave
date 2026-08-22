#!/usr/bin/env node

import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

import { withBdLaunch } from "../src/lib/bd-bin.ts";
import {
  BoundedProcessOutput,
  safeProcessErrorMessage,
  terminateProcessTree,
} from "../src/lib/process-execution.ts";
import { isDirectRun } from "./direct-run.mjs";

const DEFAULT_PHASE_TIMEOUT_MS = 90_000;
const OUTPUT_BYTES = 64 * 1024;

type SyncPhase = "pull" | "push";

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

type TerminateTree = (
  child: ChildProcess,
  options?: { platform?: NodeJS.Platform; graceMs?: number },
) => Promise<boolean>;

export type BeadsSyncOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  terminationGraceMs?: number;
  spawnProcess?: SpawnProcess;
  terminateTree?: TerminateTree;
  writeStdout?: (value: string) => void;
  writeStderr?: (value: string) => void;
};

type PhaseResult = {
  status: number;
  stdout: string;
  stderr: string;
  kind: "completed" | "timed-out" | "cleanup-unproven" | "spawn-failed";
  error?: string;
};

function positiveFiniteTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("Beads sync timeout must be a positive finite number");
  }
  return Math.ceil(value);
}

function writeRetained(write: (value: string) => void, value: string): void {
  if (!value) return;
  write(value.endsWith("\n") ? value : `${value}\n`);
}

function retryGuidance(write: (value: string) => void): void {
  write("[beads:sync] Retry `pnpm beads:sync` once.\n");
  write(
    "[beads:sync] Do not edit Git configuration or credential helpers after one transient 403.\n",
  );
  write(
    "[beads:sync] For pending Beads changes, compare `git ls-remote origin refs/dolt/data` before and after the retry.\n",
  );
}

async function runPhase(
  phase: SyncPhase,
  options: Required<
    Pick<
      BeadsSyncOptions,
      | "env"
      | "platform"
      | "timeoutMs"
      | "spawnProcess"
      | "terminateTree"
      | "writeStdout"
      | "writeStderr"
    >
  > & Pick<BeadsSyncOptions, "terminationGraceMs">,
): Promise<PhaseResult> {
  const launch = withBdLaunch("bd", ["dolt", phase]);
  const stdout = new BoundedProcessOutput(OUTPUT_BYTES);
  const stderr = new BoundedProcessOutput(OUTPUT_BYTES);
  let child: ChildProcess;

  try {
    child = options.spawnProcess(launch.command, launch.args, {
      env: {
        ...options.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
      },
      windowsHide: true,
      shell: false,
      detached: options.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      status: 1,
      stdout: "",
      stderr: "",
      kind: "spawn-failed",
      error: safeProcessErrorMessage(error, "Beads CLI"),
    };
  }

  child.stdout?.on("data", (chunk) => stdout.append(chunk));
  child.stderr?.on("data", (chunk) => stderr.append(chunk));

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (result: PhaseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const retained = () => ({
      stdout: stdout.text(),
      stderr: stderr.text(),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void options
        .terminateTree(child, {
          platform: options.platform,
          graceMs: options.terminationGraceMs,
        })
        .then((cleanupProven) => {
          finish({
            status: cleanupProven ? 124 : 1,
            ...retained(),
            kind: cleanupProven ? "timed-out" : "cleanup-unproven",
          });
        })
        .catch(() => {
          finish({
            status: 1,
            ...retained(),
            kind: "cleanup-unproven",
          });
        });
    }, options.timeoutMs);

    child.once("error", (error) => {
      finish({
        status: 1,
        ...retained(),
        kind: "spawn-failed",
        error: safeProcessErrorMessage(error, "Beads CLI"),
      });
    });
    child.once("close", (code) => {
      if (timedOut) return;
      finish({
        status: code ?? 1,
        ...retained(),
        kind: "completed",
      });
    });
  });
}

export async function runBeadsSync(options: BeadsSyncOptions = {}): Promise<number> {
  const timeoutMs = positiveFiniteTimeout(
    options.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS,
  );
  const writeStdout = options.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr = options.writeStderr ?? ((value) => process.stderr.write(value));
  const resolved = {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    timeoutMs,
    terminationGraceMs: options.terminationGraceMs,
    spawnProcess: options.spawnProcess ?? spawn,
    terminateTree: options.terminateTree ?? terminateProcessTree,
    writeStdout,
    writeStderr,
  };

  for (const phase of ["pull", "push"] as const) {
    writeStdout(`[beads:sync] ${phase}\n`);
    const result = await runPhase(phase, resolved);
    writeRetained(writeStdout, result.stdout);
    writeRetained(writeStderr, result.stderr);

    if (result.kind === "spawn-failed") {
      writeStderr(`[beads:sync] ${phase} failed: ${result.error}\n`);
      if (phase === "push") retryGuidance(writeStderr);
      return 1;
    }
    if (result.kind === "timed-out") {
      writeStderr(
        `[beads:sync] ${phase} timed out after ${timeoutMs}ms; owned process tree terminated.\n`,
      );
      if (phase === "push") retryGuidance(writeStderr);
      return 124;
    }
    if (result.kind === "cleanup-unproven") {
      writeStderr(
        `[beads:sync] ${phase} timed out after ${timeoutMs}ms and could not prove process-tree cleanup.\n`,
      );
      if (phase === "push") retryGuidance(writeStderr);
      return 1;
    }
    if (result.status !== 0) {
      writeStderr(
        `[beads:sync] ${phase} exited with status ${result.status}.\n`,
      );
      if (phase === "push") retryGuidance(writeStderr);
      return result.status;
    }
  }

  return 0;
}

async function main(): Promise<void> {
  process.exitCode = await runBeadsSync();
}

if (isDirectRun(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(
      `[beads:sync] ${safeProcessErrorMessage(error, "Beads sync")}\n`,
    );
    process.exitCode = 1;
  });
}
