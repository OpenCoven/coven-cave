import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { compareSemver } from "./app-update.ts";
import {
  openCovenToolState,
  type OpenCovenToolState,
} from "@/lib/opencoven-tools-state";
import {
  covenLaunchCommandForBinary,
  covenSpawnEnv,
  pickWindowsLauncher,
  refreshCovenSpawnEnv,
} from "./coven-bin.ts";

const execFileAsync = promisify(execFile);

export const OPEN_COVEN_TOOLS = [
  {
    id: "coven-cli",
    label: "Coven CLI",
    packageName: "@opencoven/cli",
    binary: "coven",
    versionArgs: ["--version"],
    minimumVersion: "0.0.54",
    installCommand: "npm i -g @opencoven/cli@latest",
  },
  {
    id: "coven-code",
    label: "Coven Code",
    // The SCOPED package only — bare "coven-code" on npm is a different,
    // deprecated package (stuck at 0.0.22). The scoped package still ships
    // the `coven-code` binary, so detection below is unchanged, and the
    // 0.6.0 floor makes a lingering deprecated install read as incompatible
    // and route users through the update flow.
    packageName: "@opencoven/coven-code",
    binary: "coven-code",
    versionArgs: ["--version"],
    minimumVersion: "0.6.0",
    installCommand: "npm i -g @opencoven/coven-code@latest",
  },
] as const;

export type OpenCovenToolId = (typeof OPEN_COVEN_TOOLS)[number]["id"];
type ToolSpec = (typeof OPEN_COVEN_TOOLS)[number];

type InstalledTool = {
  path: string;
  version: string | null;
};

type NpmLatestCheckError =
  | "npm_unavailable"
  | "timeout"
  | "registry_error"
  | "malformed_version";

export type NpmLatestCheck =
  | {
      status: "verified";
      checkedAt: string;
      latest: string;
    }
  | {
      status: "failed";
      checkedAt: string;
      error: NpmLatestCheckError;
    };

type CommandLaunch = {
  command: string;
  fixedArgs: string[];
};

type NpmLatestCheckDependencies = {
  platform?: NodeJS.Platform;
  env?: () => NodeJS.ProcessEnv;
  refreshEnv?: () => NodeJS.ProcessEnv;
  resolveNpmPath?: (env: NodeJS.ProcessEnv) => Promise<string | null>;
  fileExists?: (file: string) => boolean;
  execFile?: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; timeout: number },
  ) => Promise<{ stdout: string }>;
  now?: () => Date;
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
  latestCheck: NpmLatestCheck;
  outdated: boolean;
  compatible: boolean;
  state: OpenCovenToolState;
  minimumVersion: string;
  installCommand: string;
  checkedAt: string;
};

async function commandPath(binary: string): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  const find = async (env: NodeJS.ProcessEnv): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync(finder, [binary], {
        env,
        timeout: 1500,
      });
      const lines = stdout.split(/\r?\n/);
      // `where` lists npm's unspawnable extensionless launcher first; the
      // .cmd/.exe sibling is the one execFile can actually run (versions
      // below, and callers that spawn the returned path).
      return process.platform === "win32"
        ? pickWindowsLauncher(lines)
        : lines.map((l) => l.trim()).find(Boolean) ?? null;
    } catch {
      return null;
    }
  };
  // covenSpawnEnv() caches PATH for the server's lifetime. A cave launched from
  // Finder/Spotlight starts with a minimal PATH (no nvm/fnm), so a tool the
  // user actually has goes undetected and shows as "Not installed". Re-probe
  // once with a freshly rebuilt PATH before concluding the binary is missing.
  const found = await find(covenSpawnEnv());
  if (found) return found;
  return find(refreshCovenSpawnEnv());
}

function firstSemver(text: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(text);
  return match?.[1] ?? null;
}

async function installedTool(tool: ToolSpec): Promise<InstalledTool | null> {
  const path = await commandPath(tool.binary);
  if (!path) return null;
  // Node refuses to execFile a .cmd directly (EINVAL since the batch-file
  // hardening); convert npm cmd-shims to a direct `node <script>` exec so
  // the version probe works on Windows instead of silently reporting null.
  const { command, fixedArgs, unresolvedWindowsShim } = covenLaunchCommandForBinary(path);
  if (unresolvedWindowsShim) {
    // The .cmd exists, so retain its displayed path, but a parser failure must
    // never probe a different launcher or execute the batch file via a shell.
    return { path, version: null };
  }
  try {
    const { stdout, stderr } = await execFileAsync(command, [...fixedArgs, ...tool.versionArgs], {
      env: covenSpawnEnv(),
      timeout: 2500,
    });
    return { path, version: firstSemver(`${stdout}\n${stderr}`) };
  } catch {
    return { path, version: null };
  }
}

async function execLatestVersion(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number },
): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync(command, args, options);
  return { stdout: String(stdout) };
}

/**
 * npm on Windows is normally a .cmd shim, which Node refuses to execute with
 * execFile. The shim's npm CLI lives at this fixed sibling path, so run it
 * directly with Cave's Node process instead of going through cmd.exe. That
 * keeps the registry probe argv-only: neither a shell string nor request data
 * is ever involved.
 */
export function npmViewLaunchCommandForPath(
  npmPath: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (file: string) => boolean = existsSync,
): CommandLaunch | null {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(npmPath)) {
    return { command: npmPath, fixedArgs: [] };
  }
  const npmCli = path.join(
    path.dirname(npmPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return fileExists(npmCli) ? { command: process.execPath, fixedArgs: [npmCli] } : null;
}

async function npmPathFromEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exec: NpmLatestCheckDependencies["execFile"] = execLatestVersion,
): Promise<string | null> {
  const finder = platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await exec(finder, ["npm"], { env, timeout: 1500 });
    const lines = stdout.split(/\r?\n/);
    return platform === "win32"
      ? pickWindowsLauncher(lines)
      : lines.map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function latestCheckError(err: unknown): NpmLatestCheckError {
  const details = err as { code?: unknown; killed?: unknown; signal?: unknown } | undefined;
  const code = details?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === "ENOENT") return "npm_unavailable";
  if (
    code === "ETIMEDOUT" ||
    (details?.killed === true && details.signal === "SIGTERM") ||
    /timed?\s*out/i.test(message)
  ) {
    return "timeout";
  }
  return "registry_error";
}

/**
 * Read an allowlisted package's npm latest tag. A lookup failure remains
 * best-effort, but is represented explicitly so callers can never mistake an
 * unknown latest version for a confirmed current version.
 */
export async function checkNpmLatestVersion(
  tool: Pick<ToolSpec, "packageName">,
  dependencies: NpmLatestCheckDependencies = {},
): Promise<NpmLatestCheck> {
  const checkedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const platform = dependencies.platform ?? process.platform;
  const exec = dependencies.execFile ?? execLatestVersion;
  // Track which environment actually located npm and run the registry query
  // with that same environment — if only the refreshed PATH makes npm/node
  // resolvable (e.g. a shebang's `/usr/bin/env node`), executing with the
  // original env could fail right after a successful lookup.
  let env = (dependencies.env ?? covenSpawnEnv)();
  let npmPath: string | null;
  if (dependencies.resolveNpmPath) {
    npmPath = await dependencies.resolveNpmPath(env);
    if (!npmPath) {
      const refreshed = (dependencies.refreshEnv ?? refreshCovenSpawnEnv)();
      npmPath = await dependencies.resolveNpmPath(refreshed);
      if (npmPath) env = refreshed;
    }
  } else {
    npmPath = await npmPathFromEnvironment(env, platform, exec);
    if (!npmPath) {
      const refreshed = (dependencies.refreshEnv ?? refreshCovenSpawnEnv)();
      npmPath = await npmPathFromEnvironment(refreshed, platform, exec);
      if (npmPath) env = refreshed;
    }
  }
  const launch = npmPath
    ? npmViewLaunchCommandForPath(npmPath, platform, dependencies.fileExists)
    : null;
  if (!launch) {
    return { status: "failed", checkedAt, error: "npm_unavailable" };
  }

  try {
    const { stdout } = await exec(
      launch.command,
      [...launch.fixedArgs, "view", tool.packageName, "version", "--json"],
      { env, timeout: 5000 },
    );
    const parsed = JSON.parse(stdout);
    const latest = typeof parsed === "string" ? firstSemver(parsed) : null;
    return latest
      ? { status: "verified", checkedAt, latest }
      : { status: "failed", checkedAt, error: "malformed_version" };
  } catch (err) {
    return { status: "failed", checkedAt, error: latestCheckError(err) };
  }
}

export function composeOpenCovenToolStatus(
  tool: ToolSpec,
  installed: InstalledTool | null,
  latestCheck: NpmLatestCheck,
): OpenCovenToolStatus {
  const latest = latestCheck.status === "verified" ? latestCheck.latest : null;
  const outdated =
    !!installed?.version && !!latest && compareSemver(latest, installed.version) > 0;
  const compatible =
    !!installed?.version && compareSemver(installed.version, tool.minimumVersion) >= 0;
  const state = openCovenToolState({
    installed: !!installed,
    current: installed?.version ?? null,
    latest,
    outdated,
    compatible,
    minimumVersion: tool.minimumVersion,
  });

  return {
    id: tool.id,
    label: tool.label,
    packageName: tool.packageName,
    binary: tool.binary,
    installed: !!installed,
    path: installed?.path ?? null,
    current: installed?.version ?? null,
    latest,
    latestCheck,
    outdated,
    compatible,
    state,
    minimumVersion: tool.minimumVersion,
    installCommand: tool.installCommand,
    checkedAt: latestCheck.checkedAt,
  };
}

async function toolStatus(tool: ToolSpec): Promise<OpenCovenToolStatus> {
  const [installed, latestCheck] = await Promise.all([
    installedTool(tool),
    checkNpmLatestVersion(tool),
  ]);
  return composeOpenCovenToolStatus(tool, installed, latestCheck);
}

export async function openCovenToolStatuses(): Promise<OpenCovenToolStatus[]> {
  return Promise.all(OPEN_COVEN_TOOLS.map(toolStatus));
}
