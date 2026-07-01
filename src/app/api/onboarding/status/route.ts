import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { callDaemon } from "@/lib/coven-daemon";
import { loadConfig } from "@/lib/cave-config";
import { covenLaunchCommand, covenSpawnEnv } from "@/lib/coven-bin";
import {
  openCovenToolStatuses,
  type OpenCovenToolStatus,
} from "@/lib/opencoven-tools-status";
import {
  COMPATIBILITY_ADAPTERS,
  covenHelpSupportsAdapterList,
  mergeAdapterReports,
  runtimeSourceSetupState,
  type AdapterReport,
  type CovenAdapterSummary,
} from "@/lib/harness-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const COVEN_CLI_INSTALL_COMMAND = "npm i -g @opencoven/cli@latest";

type Step = { ok: boolean; detail?: string; hint?: string; optional?: boolean };

function gitInstallHint(): string {
  if (process.platform === "darwin") {
    return "Install Git with `xcode-select --install` or from https://git-scm.com, then re-check.";
  }
  if (process.platform === "win32") {
    return "Install Git from https://git-scm.com/download/win, then re-check.";
  }
  return "Install Git with your package manager (e.g. `sudo apt install git`), then re-check.";
}

/**
 * Advisory: Cave boots and chats without git (Node ships inside the app
 * bundle), but the changes panel, project file tree, and checkpoints all
 * shell out to it. Missing git never blocks onboarding completion.
 */
async function checkGit(): Promise<Step> {
  const found = await commandPath("git");
  if (found) return { ok: true, optional: true, detail: found };
  return {
    ok: false,
    optional: true,
    hint: `Chat works without it, but the changes panel, project files, and checkpoints need Git. ${gitInstallHint()}`,
  };
}

function checkCovenCli(tool: OpenCovenToolStatus | undefined): Step {
  if (!tool?.installed) {
    return {
      ok: false,
      hint: `Install the coven CLI with \`${COVEN_CLI_INSTALL_COMMAND}\`, make sure it is on PATH, then re-check.`,
    };
  }
  if (tool.outdated) {
    const detail =
      tool.current && tool.latest
        ? `Update available: ${tool.current} -> ${tool.latest}`
        : "Update available";
    return {
      ok: false,
      detail,
      hint: `Update the coven CLI with \`${COVEN_CLI_INSTALL_COMMAND}\`, then re-check.`,
    };
  }
  const location = tool.path ?? tool.binary;
  return {
    ok: true,
    detail: tool.current ? `${tool.current} at ${location}` : `${location} (version unknown)`,
  };
}

async function commandPath(binary: string): Promise<string | null> {
  const command = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(command, [binary], {
      env: covenSpawnEnv(),
      timeout: 1500,
    });
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

async function countOpenClawAgents(): Promise<number> {
  const agentsRoot = path.join(homedir(), ".openclaw", "agents");
  try {
    const entries = await readdir(agentsRoot, { withFileTypes: true });
    return entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith("."),
    ).length;
  } catch {
    return 0;
  }
}

async function checkHarnessAdapters(
  openclawAgentCount: number,
): Promise<{ step: Step; reports: AdapterReport[] }> {
  const localReports: AdapterReport[] = await Promise.all(
    COMPATIBILITY_ADAPTERS.map(async (adapter) => {
      const found = await commandPath(adapter.binary);
      return {
        id: adapter.id,
        label: adapter.label,
        binary: adapter.binary,
        chatSupported: adapter.chatSupported,
        installed: !!found,
        path: found,
        version: null,
        installHint: adapter.installHint,
        source: adapter.source,
        manifestPath: null,
      };
    }),
  );
  const reports = mergeAdapterReports(
    localReports,
    await loadCovenAdapterSummaries(),
  );
  return { step: runtimeSourceSetupState(reports, openclawAgentCount), reports };
}

async function loadCovenAdapterSummaries(): Promise<CovenAdapterSummary[]> {
  try {
    const { command, fixedArgs } = covenLaunchCommand();
    const { stdout: helpText } = await execFileAsync(command, [...fixedArgs, "--help"], {
      env: covenSpawnEnv(),
      timeout: 1500,
    });
    if (!covenHelpSupportsAdapterList(helpText)) return [];
    const { stdout } = await execFileAsync(
      command,
      [...fixedArgs, "adapter", "list", "--json"],
      {
        env: covenSpawnEnv(),
        timeout: 3000,
      },
    );
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as CovenAdapterSummary[]) : [];
  } catch {
    return [];
  }
}

async function checkCovenHome(): Promise<Step> {
  const p = path.join(homedir(), ".coven");
  try {
    const s = await stat(p);
    if (s.isDirectory()) return { ok: true, detail: p };
  } catch {
    /* missing */
  }
  return { ok: false, hint: "Cave can create ~/.coven for you." };
}

async function checkDaemon(): Promise<Step> {
  const res = await callDaemon<{ ok?: boolean }>({
    path: "/api/v1/health",
    timeoutMs: 800,
  });
  if (res.ok) return { ok: true, detail: "daemon socket reachable" };
  return { ok: false, hint: res.error ?? `daemon http ${res.status}` };
}

async function checkFamiliars(): Promise<{ step: Step; count: number }> {
  const res = await callDaemon<unknown[]>({
    path: "/api/v1/familiars",
    timeoutMs: 800,
  });
  const count = Array.isArray(res.data) ? res.data.length : 0;
  if (res.ok && count > 0) {
    return {
      step: {
        ok: true,
        detail: `${count} familiar${count === 1 ? "" : "s"} loaded`,
      },
      count,
    };
  }
  return {
    step: {
      ok: false,
      hint: res.ok
        ? "Create a familiar from any available runtime source, or add one to ~/.coven/familiars.toml."
        : "daemon offline",
    },
    count,
  };
}

// A configured default harness is only a real binding if something can
// actually back it: an installed runtime adapter, or — for OpenClaw —
// at least one discoverable agent. Without this, a stale `defaults.harness`
// (e.g. "openclaw") advertises a confident binding on a machine where neither
// the runtime nor any agent exists.
function defaultHarnessAvailable(
  harness: string,
  reports: AdapterReport[],
  openclawAgentCount: number,
): boolean {
  if (harness === "openclaw" && openclawAgentCount > 0) return true;
  return reports.some((report) => report.id === harness && report.installed);
}

function availableRuntimeLabels(
  reports: AdapterReport[],
  openclawAgentCount: number,
): string[] {
  const labels = reports
    .filter((report) => report.installed)
    .map((report) => report.label);
  if (openclawAgentCount > 0 && !labels.includes("OpenClaw")) {
    labels.push(
      `OpenClaw (${openclawAgentCount} agent${openclawAgentCount === 1 ? "" : "s"})`,
    );
  }
  return labels;
}

async function checkBinding(
  familiarsAvailable: boolean,
  daemonOk: boolean,
  reports: AdapterReport[],
  openclawAgentCount: number,
): Promise<Step> {
  const config = await loadConfig();
  const { harness, model } = config.defaults;
  const hasDefaults = !!harness && !!model;
  if (!hasDefaults) {
    return {
      ok: false,
      hint: "Create a familiar from Codex, Claude Code, Hermes, or an OpenClaw agent.",
    };
  }
  if (!familiarsAvailable) {
    // With the daemon down the familiar count is unknown, not zero — point
    // at the actual blocker instead of blaming the user's bindings.
    return {
      ok: false,
      hint: daemonOk
        ? "Bindings set but no familiars to bind."
        : "Waiting for the daemon — familiars load once it starts.",
    };
  }
  // Defaults + familiars exist, but the default harness itself must be live —
  // otherwise the binding detail advertises a runtime the user can't use.
  if (!defaultHarnessAvailable(harness, reports, openclawAgentCount)) {
    const report = reports.find((entry) => entry.id === harness);
    const label = report?.label ?? harness;
    const available = availableRuntimeLabels(reports, openclawAgentCount);
    if (available.length > 0) {
      return {
        ok: false,
        hint: `Default binding "${harness} · ${model}" points at ${label}, which has no installed runtime or agent. Create a familiar from ${available.join(", ")} to update your default.`,
      };
    }
    return {
      ok: false,
      hint: `Default binding "${harness} · ${model}" has no installed runtime or OpenClaw agent.${
        report?.installHint ? ` ${report.installHint}` : ""
      }`,
    };
  }
  return {
    ok: true,
    detail: `${harness} · ${model}`,
  };
}

export async function GET() {
  const openclawAgentCount = await countOpenClawAgents();
  const [openCovenTools, covenHome, git, daemon, familiarsRes] = await Promise.all([
    openCovenToolStatuses(),
    checkCovenHome(),
    checkGit(),
    checkDaemon(),
    checkFamiliars(),
  ]);
  const covenCli = checkCovenCli(
    openCovenTools.find((tool) => tool.id === "coven-cli"),
  );
  const adapters = await checkHarnessAdapters(openclawAgentCount);
  const binding = await checkBinding(
    familiarsRes.count > 0,
    daemon.ok,
    adapters.reports,
    openclawAgentCount,
  );

  const steps = {
    covenCli,
    covenHome,
    git,
    adapters: adapters.step,
    daemon,
    familiars: familiarsRes.step,
    binding,
  };
  // Optional steps (git) surface in the checklist but never gate completion.
  const complete = Object.values(steps).every((s) => s.ok || s.optional);

  return NextResponse.json({ ok: true, complete, steps, tools: openCovenTools });
}
