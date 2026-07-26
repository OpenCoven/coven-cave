import { spawn } from "node:child_process";
import type { CovenLaunchCommand } from "./coven-bin.ts";
import {
  evaluateRuntimeAvailability,
  missingRunnerMessage,
  type RuntimeAvailability,
  type RuntimeAvailabilityProbe,
} from "./runtime-availability.ts";

type CodexUnavailable = Extract<RuntimeAvailability, { state: Exclude<RuntimeAvailability["state"], "ready"> }> & {
  component: "coven" | "adapter";
};

export type CovenAdapterListResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  launchErrorCode?: string;
};

export type CovenAdapterListProbe = (
  launch: CovenLaunchCommand,
  env: NodeJS.ProcessEnv,
) => Promise<CovenAdapterListResult>;

type CovenAdapterRow = {
  id?: unknown;
  available?: unknown;
};

const CODEX_MISSING_MESSAGE =
  "Codex CLI is unavailable to Coven. Install it with `npm install -g @openai/codex`, make sure `codex` is on PATH, then try again.";
const CODEX_ADAPTER_MESSAGE =
  "Codex adapter is unavailable or misconfigured in Coven. Update Coven and Codex, then run `coven adapter list --json` to diagnose it before retrying.";
const CODEX_PROBE_MESSAGE =
  "Coven CLI could not verify the Codex adapter before starting this turn, so it was not run. Check Coven and Codex diagnostics, then try again.";

function unavailable(
  state: CodexUnavailable["state"],
  component: CodexUnavailable["component"],
  message: string,
): CodexUnavailable {
  const code = {
    missing: "runtime_missing",
    unlaunchable: "runtime_unlaunchable",
    probe_failed: "runtime_probe_failed",
    unsupported_runtime: "runtime_unsupported",
  }[state] as CodexUnavailable["code"];
  return { state, runner: "codex", code, message, component };
}

function covenUnavailable(availability: Exclude<RuntimeAvailability, { state: "ready" }>): CodexUnavailable {
  return {
    ...availability,
    runner: "codex",
    component: "coven",
  };
}

/**
 * Classify only Coven's adapter-level, non-provider failures. This runs after
 * the Coven process has started; auth/provider text is deliberately not
 * matched and remains the child process's real runtime output.
 */
export function classifyCodexAdapterFailure(text: string): "missing" | "unlaunchable" | null {
  if (!text) return null;
  if (
    /(?:harness\s+)?[`'"]?codex[`'"]?\s+(?:is\s+)?not\s+(?:available|installed|found)/i.test(text) ||
    /(?:spawn\s+codex\s+ENOENT|codex:\s*command not found|command not found[:\s]+[`'"]?codex)/i.test(text)
  ) {
    return "missing";
  }
  if (
    /(?:unsupported|unknown|unrecognized)\s+harness\s+[`'"]?codex/i.test(text) ||
    /(?:harness\s+)?[`'"]?codex[`'"]?\s+(?:is\s+)?not\s+configured/i.test(text)
  ) {
    return "unlaunchable";
  }
  return null;
}

/**
 * Bounded, non-interactive inspection of the Codex adapter through the exact
 * Coven launch plan that native chat will use. No prompt is passed and no
 * provider/model request is made.
 */
export const runCovenAdapterList: CovenAdapterListProbe = (launch, env) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(launch.command, [...launch.fixedArgs, "adapter", "list", "--json"], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: "",
        launchErrorCode: (err as NodeJS.ErrnoException).code,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CovenAdapterListResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const append = (current: string, data: Buffer) =>
      current.length >= 64 * 1024 ? current : `${current}${data.toString("utf8")}`.slice(0, 64 * 1024);
    child.stdout.on("data", (data: Buffer) => (stdout = append(stdout, data)));
    child.stderr.on("data", (data: Buffer) => (stderr = append(stderr, data)));
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // The close/error handler settles the probe; a kill race is harmless.
      }
      finish({ exitCode: null, stdout, stderr, timedOut: true });
    }, 2500);
    child.on("error", (err: NodeJS.ErrnoException) =>
      finish({ exitCode: null, stdout, stderr, launchErrorCode: err.code }),
    );
    child.on("close", (exitCode) => finish({ exitCode, stdout, stderr }));
  });

export type CodexRuntimeAvailabilityProbe = {
  launch: CovenLaunchCommand;
  env: NodeJS.ProcessEnv;
  /** The same static filesystem check that guards every direct runner. */
  covenProbe?: Omit<RuntimeAvailabilityProbe, "runner" | "command" | "env" | "unresolvedWindowsShim">;
  adapterList?: CovenAdapterListProbe;
};

/**
 * Resolve Codex's two-layer native-chat launch contract:
 *
 * 1. Cave can safely run the resolved Coven CLI command.
 * 2. Coven, in the scoped environment the familiar will receive, reports
 *    that its Codex adapter is available.
 */
export async function probeCodexRuntimeAvailability(
  probe: CodexRuntimeAvailabilityProbe,
): Promise<RuntimeAvailability> {
  const coven = evaluateRuntimeAvailability({
    runner: "coven",
    command: probe.launch.command,
    env: probe.env,
    unresolvedWindowsShim: probe.launch.unresolvedWindowsShim === true,
    ...probe.covenProbe,
  });
  if (coven.state !== "ready") return covenUnavailable(coven);

  const result = await (probe.adapterList ?? runCovenAdapterList)(probe.launch, probe.env);
  if (result.timedOut) return unavailable("probe_failed", "adapter", CODEX_PROBE_MESSAGE);
  if (result.launchErrorCode) {
    if (result.launchErrorCode === "ENOENT") {
      return unavailable("missing", "coven", missingRunnerMessage("coven"));
    }
    return unavailable("probe_failed", "coven", CODEX_PROBE_MESSAGE);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0) {
    const classified = classifyCodexAdapterFailure(output);
    if (classified === "missing") return unavailable("missing", "adapter", CODEX_MISSING_MESSAGE);
    if (classified === "unlaunchable") return unavailable("unlaunchable", "adapter", CODEX_ADAPTER_MESSAGE);
    return unavailable("probe_failed", "adapter", CODEX_PROBE_MESSAGE);
  }

  try {
    const rows = JSON.parse(result.stdout) as unknown;
    const codex = Array.isArray(rows)
      ? rows.find((row): row is CovenAdapterRow => !!row && typeof row === "object" && (row as CovenAdapterRow).id === "codex")
      : null;
    if (!codex) return unavailable("unlaunchable", "adapter", CODEX_ADAPTER_MESSAGE);
    if (codex.available !== true) return unavailable("missing", "adapter", CODEX_MISSING_MESSAGE);
    return { state: "ready", runner: "codex", resolvedPath: coven.resolvedPath };
  } catch {
    return unavailable("probe_failed", "adapter", CODEX_PROBE_MESSAGE);
  }
}
