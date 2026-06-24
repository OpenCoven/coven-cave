import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compareSemver } from "@/lib/app-update";
import { covenSpawnEnv } from "@/lib/coven-bin";

const execFileAsync = promisify(execFile);

export const OPEN_COVEN_TOOLS = [
  {
    id: "coven-cli",
    label: "coven CLI",
    packageName: "@opencoven/cli",
    binary: "coven",
    versionArgs: ["--version"],
  },
  {
    id: "coven-code",
    label: "Coven Code",
    packageName: "coven-code",
    binary: "coven-code",
    versionArgs: ["--version"],
  },
] as const;

export type OpenCovenToolId = (typeof OPEN_COVEN_TOOLS)[number]["id"];
type ToolSpec = (typeof OPEN_COVEN_TOOLS)[number];

type InstalledTool = {
  path: string;
  version: string | null;
};

export type OpenCovenToolStatus = {
  id: OpenCovenToolId;
  label: string;
  packageName: string;
  binary: string;
  installed: boolean;
  path: string | null;
  current: string | null;
  latest: string | null;
  outdated: boolean;
  checkedAt: string;
};

async function commandPath(binary: string): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(finder, [binary], {
      env: covenSpawnEnv(),
      timeout: 1500,
    });
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function firstSemver(text: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(text);
  return match?.[1] ?? null;
}

async function installedTool(tool: ToolSpec): Promise<InstalledTool | null> {
  const path = await commandPath(tool.binary);
  if (!path) return null;
  try {
    const { stdout, stderr } = await execFileAsync(path, tool.versionArgs, {
      env: covenSpawnEnv(),
      timeout: 2500,
    });
    return { path, version: firstSemver(`${stdout}\n${stderr}`) };
  } catch {
    return { path, version: null };
  }
}

async function latestVersion(tool: ToolSpec): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("npm", ["view", tool.packageName, "version", "--json"], {
      env: covenSpawnEnv(),
      timeout: 5000,
    });
    const parsed = JSON.parse(stdout);
    return typeof parsed === "string" ? firstSemver(parsed) : null;
  } catch {
    return null;
  }
}

async function toolStatus(tool: ToolSpec): Promise<OpenCovenToolStatus> {
  const [installed, latest] = await Promise.all([
    installedTool(tool),
    latestVersion(tool),
  ]);
  const outdated =
    !!installed?.version && !!latest && compareSemver(latest, installed.version) > 0;

  return {
    id: tool.id,
    label: tool.label,
    packageName: tool.packageName,
    binary: tool.binary,
    installed: !!installed,
    path: installed?.path ?? null,
    current: installed?.version ?? null,
    latest,
    outdated,
    checkedAt: new Date().toISOString(),
  };
}

export async function openCovenToolStatuses(): Promise<OpenCovenToolStatus[]> {
  return Promise.all(OPEN_COVEN_TOOLS.map(toolStatus));
}
