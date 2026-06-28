import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  COMPATIBILITY_ADAPTERS,
  covenHelpSupportsAdapterList,
  mergeAdapterReports,
  openClawAdapterReport,
  type AdapterReport,
  type CovenAdapterSummary,
} from "@/lib/harness-adapters";
import { covenLaunchCommand, covenSpawnEnv, refreshCovenSpawnEnv } from "@/lib/coven-bin";

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
};

function whichWith(binary: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "where" : "which";
    const child = spawn(command, [binary], { env, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => resolve(code === 0 ? out.trim() || null : null));
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

function probeVersion(binary: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binary, args, { env: covenSpawnEnv(), stdio: ["ignore", "pipe", "pipe"] });
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
      resolve(out.split(/\r?\n/)[0]?.trim() || null);
    });
    child.on("error", () => {
      clearTimeout(t);
      resolve(null);
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
      const path = await which(h.binary);
      if (!path) {
        return { ...h, installed: false, path: null, version: null };
      }
      const version = await probeVersion(h.binary, h.versionArgs ?? ["--version"]);
      return { ...h, installed: true, path, version };
    }),
  );
  const covenReports = (await covenSupportsAdapterList()) ? await loadCovenAdapterSummaries() : [];
  const harnesses: AdapterReport[] = mergeAdapterReports(reports, covenReports);
  return NextResponse.json({ ok: true, harnesses });
}
