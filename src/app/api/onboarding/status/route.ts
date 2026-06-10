import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { callDaemon } from "@/lib/coven-daemon";
import { loadConfig } from "@/lib/cave-config";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
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

type Step = { ok: boolean; detail?: string; hint?: string };

async function checkCovenCli(): Promise<Step> {
  const found = await commandPath("coven");
  if (found) return { ok: true, detail: found };
  return {
    ok: false,
    hint: "Install the coven CLI from OpenCoven/coven, make sure it is on PATH, then re-check.",
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

async function checkHarnessAdapters(openclawAgentCount: number): Promise<Step> {
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
  return runtimeSourceSetupState(reports, openclawAgentCount);
}

async function loadCovenAdapterSummaries(): Promise<CovenAdapterSummary[]> {
  try {
    const { stdout: helpText } = await execFileAsync(covenBin(), ["--help"], {
      env: covenSpawnEnv(),
      timeout: 1500,
    });
    if (!covenHelpSupportsAdapterList(helpText)) return [];
    const { stdout } = await execFileAsync(
      covenBin(),
      ["adapter", "list", "--json"],
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

async function checkBinding(familiarsAvailable: boolean, daemonOk: boolean): Promise<Step> {
  const config = await loadConfig();
  const hasDefaults = !!config.defaults.harness && !!config.defaults.model;
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
  return {
    ok: true,
    detail: `${config.defaults.harness} · ${config.defaults.model}`,
  };
}

export async function GET() {
  const openclawAgentCount = await countOpenClawAgents();
  const [covenCli, covenHome, daemon, familiarsRes] = await Promise.all([
    checkCovenCli(),
    checkCovenHome(),
    checkDaemon(),
    checkFamiliars(),
  ]);
  const adapters = await checkHarnessAdapters(openclawAgentCount);
  const binding = await checkBinding(familiarsRes.count > 0, daemon.ok);

  const steps = {
    covenCli,
    covenHome,
    adapters,
    daemon,
    familiars: familiarsRes.step,
    binding,
  };
  const complete = Object.values(steps).every((s) => s.ok);

  return NextResponse.json({ ok: true, complete, steps });
}
