import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { pickVersionLine } from "@/lib/harness-version";
import {
  COMPATIBILITY_ADAPTERS,
  covenHelpSupportsAdapterList,
  mergeAdapterReports,
  openClawAdapterReport,
  type AdapterReport,
  type CovenAdapterSummary,
} from "@/lib/harness-adapters";
import { covenLaunchCommand, covenSpawnEnv, pickWindowsLauncher, refreshCovenSpawnEnv, type CovenLaunchCommand } from "@/lib/coven-bin";
import { COPILOT_NO_AUTO_UPDATE_ARG, copilotStreamSpec } from "@/lib/copilot-stream";
import { probeCodexRuntimeAvailability } from "@/lib/codex-runtime-availability";
import { grokBin, grokLaunchCommandForBinary } from "@/lib/grok-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { openCodeCommand, openCodeLaunch, openCodeSpawnEnv } from "@/lib/opencode-bin";
import { parseGrokModels, type RuntimeModelOption } from "@/lib/grok-build";
import {
  resolveCopilotRuntimeLaunch,
  type CopilotRuntimeLaunch,
} from "@/lib/server/copilot-runtime-launch";
import {
  evaluateRuntimeAvailability,
  summarizeRuntimeAvailability,
  type RuntimeAvailabilitySummary,
} from "@/lib/runtime-availability";

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
  /** Internal-only environment used for a direct runner's availability check. */
  spawnEnv?: NodeJS.ProcessEnv;
};

// Mirrors the send route's launch dispatch: copilot/grok/hermes/opencode use
// their direct CLI launch plans, everything else launches through `coven run`.
// Same commands, same spawn env shape (no familiar → shared keys only), and
// bounded filesystem stats only — this endpoint stays probe-cheap.
async function adapterAvailability(id: string): Promise<AdapterAvailability> {
  const env = id === "opencode" ? openCodeSpawnEnv(null) : harnessSpawnEnv(null);
  if (id === "codex") {
    return {
      availability: summarizeRuntimeAvailability(await probeCodexRuntimeAvailability({
        launch: covenLaunchCommand(),
        env,
      })),
    };
  }
  if (id === "copilot") {
    const stream = copilotStreamSpec();
    if (stream) {
      const copilotLaunch = await resolveCopilotRuntimeLaunch(stream.executable, {
        spawnEnv: () => harnessSpawnEnv(null),
      });
      return {
        availability: summarizeRuntimeAvailability(copilotLaunch.availability),
        copilotLaunch,
      };
    }
    // No stream manifest → copilot chats fall back to `coven run` below.
  }
  if (id === "opencode") {
    const launch = openCodeLaunch([]);
    return {
      availability: summarizeRuntimeAvailability(evaluateRuntimeAvailability({
        runner: "opencode",
        command: launch.command,
        env,
        powerShellHostedCommand: launch.input !== undefined ? openCodeCommand() : undefined,
      })),
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
    return {
      availability: summarizeRuntimeAvailability(evaluateRuntimeAvailability({
        runner: "hermes",
        command: process.platform === "win32" ? "hermes.exe" : "hermes",
        env,
      })),
    };
  }
  const launch = covenLaunchCommand();
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
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "where" : "which";
    const child = spawn(command, [binary], { env, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const found = out.trim();
      resolve(
        process.platform === "win32"
          ? pickWindowsLauncher(found.split(/\r?\n/))
          : found || null,
      );
    });
    child.on("error", () => resolve(null));
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
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binary, [...fixedArgs, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, 2500);
    child.on("close", () => {
      clearTimeout(t);
      resolve(pickVersionLine(out));
    });
    child.on("error", () => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

function probeGrokModels(
  launch: CovenLaunchCommand,
  env: NodeJS.ProcessEnv = covenSpawnEnv(),
): Promise<{ models: RuntimeModelOption[]; defaultModel: string | null }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(launch.command, [...launch.fixedArgs, "--no-auto-update", "models"], { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve({ models: [], defaultModel: null });
      return;
    }
    let output = "";
    child.stdout.on("data", (data) => (output += data.toString()));
    child.stderr.on("data", (data) => (output += data.toString()));
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ models: [], defaultModel: null });
    }, 2500);
    child.on("close", () => {
      clearTimeout(timeout);
      resolve(parseGrokModels(output));
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ models: [], defaultModel: null });
    });
  });
}

function covenSupportsAdapterList(): Promise<boolean> {
  return new Promise((resolve) => {
    const { command, fixedArgs } = covenLaunchCommand();
    const child = spawn(command, [...fixedArgs, "--help"], { env: covenSpawnEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, 1500);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve(code === 0 && covenHelpSupportsAdapterList(out));
    });
    child.on("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

function loadCovenAdapterSummaries(): Promise<CovenAdapterSummary[]> {
  return new Promise((resolve) => {
    const { command, fixedArgs } = covenLaunchCommand();
    const child = spawn(command, [...fixedArgs, "adapter", "list", "--json"], { env: covenSpawnEnv(), stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve([]);
    }, 3000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return resolve([]);
      try {
        const parsed = JSON.parse(out);
        resolve(Array.isArray(parsed) ? parsed as CovenAdapterSummary[] : []);
      } catch {
        resolve([]);
      }
    });
    child.on("error", () => {
      clearTimeout(t);
      resolve([]);
    });
  });
}

async function countOpenClawAgents(): Promise<number> {
  try {
    const entries = await readdir(path.join(homedir(), ".openclaw", "agents"), {
      withFileTypes: true,
    });
    return entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith("."),
    ).length;
  } catch {
    return 0;
  }
}

export async function GET() {
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
      const runtime = await adapterAvailability(h.id);
      const copilotLaunch = runtime.copilotLaunch;
      const resolvedBinary = h.id === "grok" ? grokBin() : h.binary;
      const path =
        copilotLaunch
          ? copilotLaunch.availability.state === "ready"
            ? copilotLaunch.availability.resolvedPath
            : null
          : h.id === "grok" && resolvedBinary !== h.binary
            ? resolvedBinary
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
            copilotLaunch?.command ?? readyGrokLaunch?.command ?? h.binary,
            copilotLaunch
              ? [COPILOT_NO_AUTO_UPDATE_ARG, ...(h.versionArgs ?? ["--version"])]
              : h.versionArgs ?? ["--version"],
            copilotLaunch?.fixedArgs ?? readyGrokLaunch?.fixedArgs,
            copilotLaunch?.env ?? grokProbeEnv,
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
