#!/usr/bin/env node

import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

import { resolveBdLaunchCommand, withBdLaunch } from "../src/lib/bd-bin.ts";
import {
  BoundedProcessOutput,
  safeProcessErrorMessage,
  terminateProcessTree,
} from "../src/lib/process-execution.ts";
import { isDirectRun } from "./direct-run.mjs";

const DEFAULT_PHASE_TIMEOUT_MS = 90_000;
const OUTPUT_BYTES = 64 * 1024;
const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
} as const;

type SyncPhase = "pull" | "push";
type SupportedSignal = keyof typeof SIGNAL_EXIT_CODES;

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
  signal?: AbortSignal;
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
  kind:
    | "completed"
    | "timed-out"
    | "cancelled"
    | "timeout-cleanup-unproven"
    | "cancellation-cleanup-unproven"
    | "spawn-failed";
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

function cancellationStatus(signal: AbortSignal): number {
  const reason = signal.reason;
  return typeof reason === "string" && reason in SIGNAL_EXIT_CODES
    ? SIGNAL_EXIT_CODES[reason as SupportedSignal]
    : 130;
}

async function runPhase(
  phase: SyncPhase,
  options: Required<
    Pick<
      BeadsSyncOptions,
      | "env"
      | "platform"
      | "signal"
      | "timeoutMs"
      | "spawnProcess"
      | "terminateTree"
      | "writeStdout"
      | "writeStderr"
    >
  > & Pick<BeadsSyncOptions, "terminationGraceMs">,
): Promise<PhaseResult> {
  const launch = withBdLaunch(
    "bd",
    ["dolt", phase],
    resolveBdLaunchCommand({
      env: options.env,
      platform: options.platform,
    }),
  );
  const stdout = new BoundedProcessOutput(OUTPUT_BYTES);
  const stderr = new BoundedProcessOutput(OUTPUT_BYTES);
  if (options.signal.aborted) {
    return {
      status: cancellationStatus(options.signal),
      stdout: "",
      stderr: "",
      kind: "cancelled",
    };
  }
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
    let terminating = false;
    const finish = (result: PhaseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const retained = () => ({
      stdout: stdout.text(),
      stderr: stderr.text(),
    });
    const terminate = (
      successKind: Extract<PhaseResult["kind"], "timed-out" | "cancelled">,
      successStatus: number,
      failureKind: Extract<
        PhaseResult["kind"],
        "timeout-cleanup-unproven" | "cancellation-cleanup-unproven"
      >,
    ) => {
      if (settled || terminating) return;
      terminating = true;
      void options
        .terminateTree(child, {
          platform: options.platform,
          graceMs: options.terminationGraceMs,
        })
        .then((cleanupProven) => {
          finish({
            status: cleanupProven ? successStatus : 1,
            ...retained(),
            kind: cleanupProven ? successKind : failureKind,
          });
        })
        .catch(() => {
          finish({
            status: 1,
            ...retained(),
            kind: failureKind,
          });
        });
    };
    const timer = setTimeout(() => {
      terminate("timed-out", 124, "timeout-cleanup-unproven");
    }, options.timeoutMs);
    const onAbort = () => {
      terminate(
        "cancelled",
        cancellationStatus(options.signal),
        "cancellation-cleanup-unproven",
      );
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) onAbort();

    child.once("error", (error) => {
      if (terminating) return;
      finish({
        status: 1,
        ...retained(),
        kind: "spawn-failed",
        error: safeProcessErrorMessage(error, "Beads CLI"),
      });
    });
    child.once("close", (code) => {
      if (terminating) return;
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
  const signal = options.signal ?? new AbortController().signal;
  const resolved = {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    signal,
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
    if (result.kind === "cancelled") {
      writeStderr(
        `[beads:sync] ${phase} cancelled; owned process tree terminated.\n`,
      );
      return result.status;
    }
    if (result.kind === "timeout-cleanup-unproven") {
      writeStderr(
        `[beads:sync] ${phase} timed out after ${timeoutMs}ms and could not prove process-tree cleanup.\n`,
      );
      if (phase === "push") retryGuidance(writeStderr);
      return 1;
    }
    if (result.kind === "cancellation-cleanup-unproven") {
      writeStderr(
        `[beads:sync] ${phase} was cancelled and could not prove process-tree cleanup.\n`,
      );
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
  const controller = new AbortController();
  const onSignal = (signal: SupportedSignal) => {
    if (!controller.signal.aborted) controller.abort(signal);
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  try {
    process.exitCode = await runBeadsSync({ signal: controller.signal });
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

if (isDirectRun(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(
      `[beads:sync] ${safeProcessErrorMessage(error, "Beads sync")}\n`,
    );
    process.exitCode = 1;
  });
}
