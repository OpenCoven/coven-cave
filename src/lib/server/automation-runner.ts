import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { covenHome } from "@/lib/coven-paths";
import { harnessSpawnEnv } from "../harness-spawn-env.ts";
import {
  codexAutomationLaunchCommand,
  codexBin,
  codexManagedPackageSpawnEnv,
  type CodexManagedPackage,
} from "../codex-bin.ts";
import { sanitizeAboutDiagnosticText } from "../about-diagnostics.ts";
import type { CodexAutomation } from "@/lib/codex-automations-types";
import {
  recordRun,
  updateRun,
  hasRunningRun,
  type AutomationRunRecord,
} from "@/lib/automation-runs.ts";

export type CodexExecInvocation = {
  command: string;
  args: string[];
  cwd: string;
  stdinPrompt: string;
  managedPackage?: CodexManagedPackage;
};

type CodexExecInvocationDependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
};

const UNSAFE_CODEX_SHIM_DIAGNOSTIC =
  "Cave could not safely resolve the Codex Windows command shim. Reinstall or update Codex, then restart Cave and try again.";
const STDERR_TAIL_BYTES = 2_000;

/** Keep auth/version/runtime failures visible without exposing paths or keys. */
export function codexAutomationFailureSummary(
  exitCode: number | null,
  stderr: string,
): string {
  const diagnostic = sanitizeAboutDiagnosticText(stderr.trim());
  return diagnostic
    ? `Codex failed: ${diagnostic}`
    : `Codex exited with code ${exitCode ?? "unknown"}. Check the run log for details.`;
}

/** Pure: how to invoke `codex exec` for an automation. Unit-tested. */
export function buildCodexExecInvocation(
  auto: CodexAutomation,
  dependencies: CodexExecInvocationDependencies = {},
): CodexExecInvocation {
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const binary = env.COVEN_CODEX_BIN?.trim() || codexBin(env, platform);
  const launch = codexAutomationLaunchCommand(binary, {
    env,
    platform,
    arch: dependencies.arch,
  });
  if (launch.unresolvedWindowsShim) {
    throw new Error(UNSAFE_CODEX_SHIM_DIAGNOSTIC);
  }
  const command = launch.command;
  const args = [
    ...launch.fixedArgs,
    // Codex deliberately downgrades workspace-write to read-only on Windows
    // when no Windows sandbox backend is selected. Research owns this
    // noninteractive child, so select the supported unelevated backend
    // explicitly; other platforms and interactive/user-owned launches keep
    // their existing policy.
    ...(platform === "win32" ? ["--config", 'windows.sandbox="unelevated"'] : []),
    "exec",
    "--skip-git-repo-check",
    "--config",
    'approval_policy="never"',
    "--sandbox",
    "workspace-write",
    ...(auto.model ? ["--model", auto.model] : []),
    "-",
  ];
  const cwd = auto.cwds[0] || process.cwd();
  return {
    command,
    args,
    cwd,
    stdinPrompt: auto.prompt,
    ...(launch.managedPackage ? { managedPackage: launch.managedPackage } : {}),
  };
}

type SpawnCodexExecDependencies = {
  spawnImpl?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  env?: NodeJS.ProcessEnv;
};

export type CodexPromptDeliveryResult =
  | { ok: true }
  | { ok: false; error: Error };

export type SpawnedCodexExecInvocation = {
  child: ChildProcess;
  promptDelivery: Promise<CodexPromptDeliveryResult>;
};

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/**
 * Spawn one already-resolved Codex invocation without a command shell. Kept
 * separate from run persistence so Windows launch options and stdin transport
 * can be regression-tested with a real injected spawn alias.
 */
export function spawnCodexExecInvocation(
  invocation: CodexExecInvocation,
  dependencies: SpawnCodexExecDependencies = {},
): SpawnedCodexExecInvocation {
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const child = Reflect.apply(spawnImpl, undefined, [
    invocation.command,
    invocation.args,
    {
      cwd: invocation.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: codexManagedPackageSpawnEnv(
        dependencies.env ?? harnessSpawnEnv(),
        invocation.managedPackage,
      ),
      shell: false,
      windowsHide: true,
    },
  ]);
  // Install the stream error handler before the first byte is written. A
  // fast-exiting native CLI otherwise turns a large prompt write into an
  // unhandled EPIPE that can terminate Cave's server process.
  const promptDelivery = new Promise<CodexPromptDeliveryResult>((resolve) => {
    const stdin = child.stdin;
    if (!stdin) {
      resolve({ ok: false, error: new Error("Codex stdin is unavailable") });
      return;
    }
    let settled = false;
    const settle = (result: CodexPromptDeliveryResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    // Keep the listener attached after `finish`: a late pipe error must still
    // be consumed even though it cannot change an already-settled result.
    stdin.on("error", (error) => {
      settle({ ok: false, error: asError(error, "Codex prompt delivery failed") });
    });
    stdin.once("finish", () => settle({ ok: true }));
    // Async CreateProcess failures (for example ENOENT) can close the stdin
    // pipe without emitting either `finish` or `error`. Treat that close as a
    // failed delivery so the child error/close completion barrier cannot hang.
    stdin.once("close", () => settle({
      ok: false,
      error: new Error("Codex stdin closed before the automation prompt was delivered"),
    }));
    try {
      stdin.end(invocation.stdinPrompt);
    } catch (error) {
      settle({ ok: false, error: asError(error, "Codex prompt delivery failed") });
    }
  });
  return { child, promptDelivery };
}

type UpdateRunImpl = typeof updateRun;

/** Coordinate child exit and stdin delivery into one monotonic terminal run. */
export function monitorCodexAutomationCompletion(
  child: ChildProcess,
  promptDelivery: Promise<CodexPromptDeliveryResult>,
  runId: string,
  dependencies: {
    output?: Writable;
    updateRunImpl?: UpdateRunImpl;
    reportPersistenceError?: (error: Error) => void;
  } = {},
): void {
  const updateRunImpl = dependencies.updateRunImpl ?? updateRun;
  const reportPersistenceError = dependencies.reportPersistenceError ?? ((error: Error) => {
    const detail = sanitizeAboutDiagnosticText(error.message);
    console.error(
      detail
        ? `AutoResearch could not persist terminal run state: ${detail}`
        : "AutoResearch could not persist terminal run state.",
    );
  });
  let stderrTail = "";
  let terminalPersisted = false;
  let closeSeen = false;
  let closeCode: number | null = null;
  let childError: Error | null = null;
  let deliveryResult: CodexPromptDeliveryResult | null = null;
  let logResult: CodexPromptDeliveryResult | null = dependencies.output
    ? null
    : { ok: true };

  const persist = (patch: Parameters<UpdateRunImpl>[1]) => {
    if (terminalPersisted) return;
    terminalPersisted = true;
    // EventEmitter does not await callbacks. Contain both synchronous throws
    // and asynchronous storage failures, retry once for transient atomic-write
    // races, then surface one sanitized diagnostic instead of creating an
    // unhandled rejection that can terminate Cave's server process.
    void (async () => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await updateRunImpl(runId, patch);
          return;
        } catch (error) {
          lastError = asError(error, "AutoResearch terminal persistence failed");
        }
      }
      try {
        reportPersistenceError(lastError ?? new Error("AutoResearch terminal persistence failed"));
      } catch {
        // A diagnostic callback is observability only and must never escape a
        // child-process event handler after the persistence error was caught.
      }
    })();
  };
  const promptFailureSummary = (error: Error) => {
    const diagnostic = sanitizeAboutDiagnosticText(error.message);
    return diagnostic
      ? `Codex could not receive the automation prompt: ${diagnostic}`
      : "Codex could not receive the automation prompt.";
  };
  const persistPromptFailure = (error: Error) => {
    persist({
      status: "failed",
      finishedAt: new Date().toISOString(),
      ...(closeSeen && closeCode !== null ? { exitCode: closeCode } : {}),
      summary: promptFailureSummary(error),
    });
  };

  const maybePersistTerminal = () => {
    // Node guarantees `close` after either successful exit or spawn `error`.
    // Waiting for it lets a real runtime exit code/stderr outrank an earlier
    // secondary EPIPE without risking a later status overwrite.
    if (terminalPersisted || !closeSeen || !deliveryResult || !logResult) return;
    if (childError) {
      persist({
        status: "failed",
        finishedAt: new Date().toISOString(),
        ...(closeCode !== null ? { exitCode: closeCode } : {}),
        summary: codexAutomationFailureSummary(null, childError.message),
      });
      return;
    }
    if (closeCode !== 0) {
      persist({
        status: "failed",
        finishedAt: new Date().toISOString(),
        ...(closeCode !== null ? { exitCode: closeCode } : {}),
        summary: codexAutomationFailureSummary(closeCode, stderrTail),
      });
      return;
    }
    if (!deliveryResult.ok) {
      persistPromptFailure(deliveryResult.error);
      return;
    }
    if (!logResult.ok) {
      const diagnostic = sanitizeAboutDiagnosticText(logResult.error.message);
      persist({
        status: "failed",
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        summary: diagnostic
          ? `Codex output log failed: ${diagnostic}`
          : "Codex output log failed.",
      });
      return;
    }
    persist({
      status: "succeeded",
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      summary: "Run completed",
    });
  };

  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderrTail = `${stderrTail}${chunk.toString()}`.slice(-STDERR_TAIL_BYTES);
  });
  child.once("error", (error) => {
    childError = asError(error, "Codex could not be started");
    maybePersistTerminal();
  });
  void promptDelivery.then(
    (result) => {
      deliveryResult = result;
      maybePersistTerminal();
    },
    (error) => {
      deliveryResult = {
        ok: false,
        error: asError(error, "Codex prompt delivery failed"),
      };
      maybePersistTerminal();
    },
  );
  child.once("close", (code) => {
    closeSeen = true;
    closeCode = code;
    maybeEndOutput();
    maybePersistTerminal();
  });

  const output = dependencies.output;
  const sources = [child.stdout, child.stderr]
    .filter((source): source is Readable => source !== null);
  const pendingSources = new Set<Readable>(sources);
  let outputEndRequested = false;
  let sourceError: Error | null = null;

  function settleSource(source: Readable, error?: unknown): void {
    if (!pendingSources.delete(source)) return;
    if (error !== undefined && sourceError === null) {
      sourceError = asError(error, "Codex output stream failed");
    }
    maybeEndOutput();
  }

  function maybeEndOutput(): void {
    if (!output || outputEndRequested || logResult || !closeSeen || pendingSources.size > 0) return;
    outputEndRequested = true;
    try {
      output.end();
    } catch (error) {
      logResult = { ok: false, error: asError(error, "Codex output log failed") };
      maybePersistTerminal();
    }
  }

  if (output) {
    output.once("finish", () => {
      logResult = sourceError
        ? { ok: false, error: sourceError }
        : { ok: true };
      maybePersistTerminal();
    });
    output.on("error", (error) => {
      if (!logResult) {
        logResult = { ok: false, error: asError(error, "Codex output log failed") };
      }
      // Once the sink fails, drain both pipes so the child cannot block on a
      // full stdout/stderr buffer while we wait for its authoritative close.
      for (const source of sources) {
        source.unpipe(output);
        source.resume();
      }
      maybePersistTerminal();
    });
    for (const source of sources) {
      source.once("end", () => settleSource(source));
      source.once("close", () => settleSource(source));
      source.once("error", (error) => settleSource(source, error));
      if (source.readableEnded || source.destroyed) {
        settleSource(source);
      } else {
        source.pipe(output, { end: false });
      }
    }
    maybeEndOutput();
  }
}

type OwnedLogLaunchDependencies = SpawnCodexExecDependencies & {
  createOutput?: (logPath: string) => Writable;
  updateRunImpl?: UpdateRunImpl;
};

/** Spawn first, then transfer the newly created log into the completion owner. */
export function startCodexExecWithOwnedLog(
  invocation: CodexExecInvocation,
  logPath: string,
  runId: string,
  dependencies: OwnedLogLaunchDependencies = {},
): SpawnedCodexExecInvocation {
  const {
    createOutput = (target) => createWriteStream(/* turbopackIgnore: true */ target, { flags: "a" }),
    updateRunImpl,
    ...spawnDependencies
  } = dependencies;
  // A synchronous spawn failure happens before the output factory is called,
  // so there is no unowned stream that can leak or emit a delayed open error.
  const launched = spawnCodexExecInvocation(invocation, spawnDependencies);
  let output: Writable | undefined;
  try {
    output = createOutput(logPath);
    monitorCodexAutomationCompletion(
      launched.child,
      launched.promptDelivery,
      runId,
      { output, ...(updateRunImpl ? { updateRunImpl } : {}) },
    );
    return launched;
  } catch (error) {
    if (output) {
      output.on("error", () => undefined);
      output.destroy();
    }
    // If output ownership setup itself fails after a successful spawn, drain
    // and stop the child rather than leaving it blocked on an unread pipe.
    launched.child.stdout?.resume();
    launched.child.stderr?.resume();
    try { launched.child.kill(); } catch { /* child already settled */ }
    throw error;
  }
}

function logDir(): string {
  return path.join(/* turbopackIgnore: true */ covenHome(), "automation-run-logs");
}

/**
 * Fire-and-forget: record a `running` run, spawn `codex exec` (prompt → stdin,
 * output → log file), and resolve immediately with the running record. The
 * completion barrier flips the record only after prompt delivery, child close,
 * and durable log settlement. Throws if a run is already in flight.
 */
export async function startAutomationRun(auto: CodexAutomation): Promise<AutomationRunRecord> {
  if (await hasRunningRun(auto.id)) {
    throw new Error("a run is already in progress for this automation");
  }
  await mkdir(/* turbopackIgnore: true */ logDir(), { recursive: true });
  const startedAt = new Date().toISOString();
  // Resolve against the same augmented Finder/desktop-safe PATH that the
  // child receives; otherwise discovery can choose a different Codex than
  // CreateProcess ultimately launches.
  const launchEnv = harnessSpawnEnv();
  const inv = buildCodexExecInvocation(auto, { env: launchEnv });
  const run = await recordRun({
    automationId: auto.id,
    automationName: auto.name,
    startedAt,
    status: "running",
  });
  const logPath = path.join(/* turbopackIgnore: true */ logDir(), `${run.id}.log`);
  await updateRun(run.id, { logPath });

  try {
    // No familiar context: automations get shared vault keys only, and the
    // explicit env replaces the previous implicit full-process.env inheritance.
    // Command and cwd are runtime configuration, not repository-relative
    // bundle inputs. Reflect keeps Turbopack's child-process tracer from
    // expanding them while preserving Node's spawn contract.
    startCodexExecWithOwnedLog(inv, logPath, run.id, { env: launchEnv });
  } catch (err) {
    await updateRun(run.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      summary: err instanceof Error ? err.message : "could not start run",
    });
  }
  return run;
}
