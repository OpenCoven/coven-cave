import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { pickVersionLine } from "@/lib/harness-version";
import {
  COMPATIBILITY_ADAPTERS,
  covenHelpSupportsAdapterList,
  mergeAdapterReports,
  openClawAdapterReport,
  type AdapterReport,
  type CovenAdapterSummary,
} from "@/lib/harness-adapters";
import {
  COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC,
  covenLaunchCommand,
  covenSpawnEnv,
  covenWrapperSpawnEnv,
  pickWindowsLauncher,
  refreshCovenSpawnEnv,
  type CovenLaunchCommand,
} from "@/lib/coven-bin";
import { COPILOT_NO_AUTO_UPDATE_ARG, copilotStreamSpec } from "@/lib/copilot-stream";
import { probeCodexRuntimeAvailability } from "@/lib/codex-runtime-availability";
import { grokBin, grokLaunchCommandForBinary } from "@/lib/grok-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { openCodeAvailabilityProbe, openCodeLaunch, openCodeSpawnEnv } from "@/lib/opencode-bin";
import { listOpenClawAgents } from "@/lib/openclaw-bridge";
import { parseGrokModels, type RuntimeModelOption } from "@/lib/grok-build";
import {
  resolveCopilotRuntimeLaunch,
  type CopilotRuntimeLaunch,
} from "@/lib/server/copilot-runtime-launch";
import {
  evaluateCovenBackedRuntimeAvailability,
  evaluateRuntimeAvailability,
  resolveHermesLaunch,
  summarizeRuntimeAvailability,
  type HermesLaunchResolution,
  type RuntimeAvailabilitySummary,
} from "@/lib/runtime-availability";
import {
  BoundedProcessOutput,
  terminateProcessTree,
} from "@/lib/process-execution";

export const dynamic = "force-dynamic";

type HarnessSpec = {
  id: string;
  label: string;
  binary: string;
  /**
   * Currently wired for native chat (POST /api/chat/send), i.e. supported by
   * `coven run <harness> --stream-json`. Others are surfaced as "installed but
   * not yet wired" so familiars can still launch them in the Coven Code TUI.
   */
  chatSupported: boolean;
  versionArgs?: string[];
};

type HarnessReport = HarnessSpec & {
  installed: boolean;
  path: string | null;
  version: string | null;
  /** Live authenticated catalog where the runtime exposes one. */
  models?: RuntimeModelOption[];
  defaultModel?: string | null;
  /** Whether the chat send route could actually spawn this adapter's launch
   * vehicle right now (#3856). */
  availability?: RuntimeAvailabilitySummary;
};

type AdapterAvailability = {
  availability: RuntimeAvailabilitySummary;
  /** Internal-only exact Copilot plan; never serialized inside availability. */
  copilotLaunch?: CopilotRuntimeLaunch;
  /** Internal-only Hermes plan shared by availability, path, and version. */
  hermesLaunch?: HermesLaunchResolution;
  /** Internal-only environment used for a direct runner's availability check. */
  spawnEnv?: NodeJS.ProcessEnv;
};

function missingCovenAvailability(component?: "coven"): RuntimeAvailabilitySummary {
  return {
    state: "missing",
    code: "runtime_missing",
    message: COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC,
    ...(component ? { component } : {}),
  };
}

function resolvedCovenLaunch(): CovenLaunchCommand | null {
  try {
    return covenLaunchCommand();
  } catch {
    return null;
  }
}

type ProbeResult = {
  code: number | null;
  output: string;
};

function runProbe(
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    captureStderr?: boolean;
    redactOutput?: boolean;
  },
): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        env: options.env,
        stdio: ["ignore", "pipe", options.captureStderr === false ? "ignore" : "pipe"],
        detached: process.platform !== "win32",
      });
    } catch {
      resolve(null);
      return;
    }
    const output = new BoundedProcessOutput(64 * 1024, {
      redact: options.redactOutput !== false,
    });
    let settled = false;
    let timedOut = false;
    const finish = (result: ProbeResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout?.on("data", (data) => output.append(data));
    child.stderr?.on("data", (data) => output.append(data));
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).then(() => finish(null));
    }, options.timeoutMs);
    child.on("error", () => finish(null));
    child.on("close", (code) =>
      finish(timedOut ? null : { code, output: output.text() }),
    );
  });
}

// Mirrors the send route's launch dispatch: copilot/grok/hermes/opencode use
// their direct CLI launch plans, everything else launches through `coven run`.
// Same commands, same spawn env shape (no familiar → shared keys only), and
// bounded filesystem stats only — this endpoint stays probe-cheap.
async function adapterAvailability(id: string): Promise<AdapterAvailability> {
  if (id === "copilot") {
    const stream = copilotStreamSpec();
    if (stream) {
      const copilotLaunch = await resolveCopilotRuntimeLaunch(stream.executable, {
        spawnEnv: (discoveryDeadline) =>
          harnessSpawnEnv(null, { discoveryDeadline }),
      });
      return {
        availability: summarizeRuntimeAvailability(copilotLaunch.availability),
        copilotLaunch,
      };
    }
    // No stream manifest → copilot chats fall back to `coven run` below.
  }
  const env = id === "opencode" ? openCodeSpawnEnv(null) : harnessSpawnEnv(null);
  if (id === "codex") {
    const launch = resolvedCovenLaunch();
    if (!launch) return { availability: missingCovenAvailability("coven") };
    return {
      availability: summarizeRuntimeAvailability(await probeCodexRuntimeAvailability({
        launch,
        env,
      })),
    };
  }
  if (id === "opencode") {
    const launch = openCodeLaunch([], process.platform, env);
    return {
      availability: summarizeRuntimeAvailability(
        evaluateRuntimeAvailability(openCodeAvailabilityProbe(launch, env)),
      ),
    };
  }
  if (id === "grok") {
    const launch = grokLaunchCommandForBinary(grokBin());
    return {
      availability: summarizeRuntimeAvailability(evaluateRuntimeAvailability({
        runner: "grok",
        command: launch.command,
        env,
        unresolvedWindowsShim: launch.unresolvedWindowsShim === true,
      })),
      spawnEnv: env,
    };
  }
  if (id === "hermes") {
    const hermesLaunch = resolveHermesLaunch({ env });
    return {
      availability: summarizeRuntimeAvailability(hermesLaunch),
      hermesLaunch,
    };
  }
  const launch = resolvedCovenLaunch();
  if (!launch) return { availability: missingCovenAvailability() };
  if (id === "claude") {
    // The chat route launches Claude through `coven run`, so readiness means
    // both the outer Coven command and Claude in that same scoped env exist.
    return {
      availability: summarizeRuntimeAvailability(evaluateCovenBackedRuntimeAvailability({
        runner: "claude",
        covenCommand: launch.command,
        env,
        unresolvedCovenWindowsShim: launch.unresolvedWindowsShim === true,
      })),
    };
  }
  return {
    availability: summarizeRuntimeAvailability(evaluateRuntimeAvailability({
      runner: "coven",
      command: launch.command,
      env,
      unresolvedWindowsShim: launch.unresolvedWindowsShim === true,
    })),
  };
}

function whichWith(binary: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const command = process.platform === "win32" ? "where" : "which";
  return runProbe(command, [binary], {
    env,
    timeoutMs: 1_500,
    captureStderr: false,
  }).then((result) => {
    if (result?.code !== 0) return null;
    const found = result.output.trim();
    return process.platform === "win32"
      ? pickWindowsLauncher(found.split(/\r?\n/))
      : found || null;
  });
}

// covenSpawnEnv() caches PATH for the server's lifetime. A cave launched from
// Finder/Spotlight starts with a minimal PATH (no nvm/fnm), so installed
// runtimes go undetected and Option A renders empty. Re-probe once with a
// freshly rebuilt PATH on a miss before reporting the runtime as absent.
async function which(binary: string): Promise<string | null> {
  const found = await whichWith(binary, covenSpawnEnv());
  if (found) return found;
  return whichWith(binary, refreshCovenSpawnEnv());
}

function probeVersion(
  binary: string,
  args: string[],
  fixedArgs: string[] = [],
  env: NodeJS.ProcessEnv = covenSpawnEnv(),
): Promise<string | null> {
  return runProbe(binary, [...fixedArgs, ...args], {
    env,
    timeoutMs: 2_500,
  }).then((result) => result ? pickVersionLine(result.output) : null);
}

function probeGrokModels(
  launch: CovenLaunchCommand,
  env: NodeJS.ProcessEnv = covenSpawnEnv(),
): Promise<{ models: RuntimeModelOption[]; defaultModel: string | null }> {
  return runProbe(
    launch.command,
    [...launch.fixedArgs, "--no-auto-update", "models"],
    { env, timeoutMs: 2_500 },
  ).then((result) =>
    result
      ? parseGrokModels(result.output)
      : { models: [], defaultModel: null },
  );
}

function covenSupportsAdapterList(): Promise<boolean> {
  const launch = resolvedCovenLaunch();
  if (!launch) return Promise.resolve(false);
  const { command, fixedArgs } = launch;
  return runProbe(command, [...fixedArgs, "--help"], {
    env: covenWrapperSpawnEnv(),
    timeoutMs: 1_500,
  }).then((result) =>
    result?.code === 0 && covenHelpSupportsAdapterList(result.output),
  );
}

function loadCovenAdapterSummaries(): Promise<CovenAdapterSummary[]> {
  const launch = resolvedCovenLaunch();
  if (!launch) return Promise.resolve([]);
  const { command, fixedArgs } = launch;
  return runProbe(command, [...fixedArgs, "adapter", "list", "--json"], {
    env: covenWrapperSpawnEnv(),
    timeoutMs: 3_000,
    captureStderr: false,
    redactOutput: false,
  }).then((result) => {
    if (result?.code !== 0) return [];
    try {
      const parsed = JSON.parse(result.output);
      return Array.isArray(parsed) ? parsed as CovenAdapterSummary[] : [];
    } catch {
      return [];
    }
  });
}

async function countOpenClawAgents(): Promise<number> {
  return (await listOpenClawAgents()).length;
}

export async function GET() {
  const copilotRuntime = await adapterAvailability("copilot");
  const openclawAgentCount = await countOpenClawAgents();
  const reports: HarnessReport[] = await Promise.all(
    COMPATIBILITY_ADAPTERS.map(async (h) => {
      if (h.id === "openclaw") {
        return openClawAdapterReport(openclawAgentCount);
      }
      // Native Grok resolution also recognizes `grok.exe` from an imported
      // Windows PATH in WSL. `which grok` on Linux does not apply PATHEXT, so
      // using only the generic probe would hide a runnable Windows install
      // from the summoning circle even though the chat launcher can execute it.
      const runtime = h.id === "copilot"
        ? copilotRuntime
        : await adapterAvailability(h.id);
      const copilotLaunch = runtime.copilotLaunch;
      const hermesLaunch = runtime.hermesLaunch;
      const resolvedBinary = h.id === "grok" ? grokBin() : h.binary;
      const path =
        copilotLaunch
          ? copilotLaunch.availability.state === "ready"
            ? copilotLaunch.availability.resolvedPath
            : null
          : h.id === "grok" && resolvedBinary !== h.binary
            ? resolvedBinary
            : h.id === "hermes"
              ? hermesLaunch?.state === "ready" ? hermesLaunch.command : null
              : await which(h.binary);
      const availability = runtime.availability;
      if (!path || (h.id === "codex" && availability.state !== "ready")) {
        return { ...h, installed: false, path: null, version: null, availability };
      }
      const grokLaunch = h.id === "grok" ? grokLaunchCommandForBinary(path) : null;
      const grokProbeEnv = h.id === "grok" ? runtime.spawnEnv : undefined;
      const grokReady = h.id === "grok" && availability.state === "ready";
      const readyGrokLaunch = grokReady ? grokLaunch : null;
      const version = h.id === "grok" && !grokReady
        ? null
        : await probeVersion(
            copilotLaunch?.command
              ?? readyGrokLaunch?.command
              ?? (hermesLaunch?.state === "ready" ? hermesLaunch.command : h.binary),
            copilotLaunch
              ? [COPILOT_NO_AUTO_UPDATE_ARG, ...(h.versionArgs ?? ["--version"])]
              : h.versionArgs ?? ["--version"],
            copilotLaunch?.fixedArgs ?? readyGrokLaunch?.fixedArgs,
            (copilotLaunch?.env ?? grokProbeEnv)
              ?? (hermesLaunch?.state === "ready" ? hermesLaunch.env : undefined),
          );
      const grokCatalog = readyGrokLaunch ? await probeGrokModels(readyGrokLaunch, grokProbeEnv) : null;
      return {
        ...h,
        installed: true,
        path,
        version,
        ...(grokCatalog ? grokCatalog : {}),
        availability,
      };
    }),
  );
  const covenReports = (await covenSupportsAdapterList()) ? await loadCovenAdapterSummaries() : [];
  const harnesses: AdapterReport[] = mergeAdapterReports(reports, covenReports);
  return NextResponse.json({ ok: true, runtimeHost: hostname(), harnesses });
}
