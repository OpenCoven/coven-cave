import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { COMPATIBILITY_ADAPTERS, mergeAdapterReports, type AdapterReport, type CovenAdapterSummary } from "@/lib/harness-adapters";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";

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

function which(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "where" : "which";
    const child = spawn(command, [binary], { env: covenSpawnEnv(), stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => resolve(code === 0 ? out.trim() || null : null));
    child.on("error", () => resolve(null));
  });
}

function probeVersion(binary: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { env: covenSpawnEnv(), stdio: ["ignore", "pipe", "pipe"] });
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

function loadCovenAdapterSummaries(): Promise<CovenAdapterSummary[]> {
  return new Promise((resolve) => {
    const child = spawn(covenBin(), ["adapter", "list", "--json"], { env: covenSpawnEnv(), stdio: ["ignore", "pipe", "ignore"] });
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

export async function GET() {
  const reports: HarnessReport[] = await Promise.all(
    COMPATIBILITY_ADAPTERS.map(async (h) => {
      const path = await which(h.binary);
      if (!path) {
        return { ...h, installed: false, path: null, version: null };
      }
      const version = await probeVersion(h.binary, h.versionArgs ?? ["--version"]);
      return { ...h, installed: true, path, version };
    }),
  );
  const covenReports = await loadCovenAdapterSummaries();
  const harnesses: AdapterReport[] = mergeAdapterReports(reports, covenReports);
  return NextResponse.json({ ok: true, harnesses });
}
