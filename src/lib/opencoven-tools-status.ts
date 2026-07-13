import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { compareSemver } from "./app-update.ts";
import {
  covenLaunchCommandForBinary,
  covenSpawnEnv,
  pickWindowsLauncher,
  refreshCovenSpawnEnv,
} from "./coven-bin.ts";
import {
  evaluateOpenCovenToolVerification,
  type OpenCovenToolProbe,
  type OpenCovenToolVerification,
} from "./opencoven-tool-verification.ts";

export type {
  OpenCovenToolProbe,
  OpenCovenToolVerification,
} from "./opencoven-tool-verification.ts";

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
  executablePath: string | null;
  current: string | null;
  latest: string | null;
  latestCheck: NpmLatestCheck;
  outdated: boolean;
  compatible: boolean;
  packageVerified: boolean;
  executableVerified: boolean;
  packagePath: string | null;
  discoveryError: OpenCovenToolProbe["error"] | null;
  minimumVersion: string;
  installCommand: string;
  checkedAt: string;
};

function firstSemver(text: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(text);
  return match?.[1] ?? null;
}

async function resolvedExecutablePath(binaryPath: string): Promise<string | null> {
  const launch = covenLaunchCommandForBinary(binaryPath);
  if (launch.unresolvedWindowsShim) return null;
  if (launch.command === process.execPath && launch.fixedArgs[0]) {
    try {
      return await realpath(launch.fixedArgs[0]);
    } catch {
      return launch.fixedArgs[0];
    }
  }
  try {
    return await realpath(binaryPath);
  } catch {
    return null;
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}

type PackageIdentity = {
  name: string;
  path: string;
  binaryVerified: boolean;
};

async function packageIdentityForExecutable(
  executablePath: string,
  binary: string,
): Promise<PackageIdentity | null> {
  let directory = path.dirname(executablePath);
  for (let depth = 0; depth < 16; depth += 1) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as {
        name?: unknown;
        bin?: unknown;
      };
      if (typeof manifest.name === "string") {
        const binPath =
          typeof manifest.bin === "string"
            ? manifest.bin
            : manifest.bin &&
                typeof manifest.bin === "object" &&
                !Array.isArray(manifest.bin) &&
                typeof (manifest.bin as Record<string, unknown>)[binary] === "string"
              ? (manifest.bin as Record<string, string>)[binary]
              : null;
        let binaryVerified = false;
        if (binPath) {
          const expectedPath = path.resolve(directory, binPath);
          try {
            binaryVerified = samePath(await realpath(expectedPath), executablePath);
          } catch {
            binaryVerified = samePath(expectedPath, executablePath);
          }
        }
        return { name: manifest.name, path: directory, binaryVerified };
      }
    } catch {
      /* Keep walking toward the package root. */
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

export async function discoverOpenCovenTool(
  tool: ToolSpec,
  options: { refresh?: boolean } = {},
): Promise<OpenCovenToolProbe> {
  const env = options.refresh ? refreshCovenSpawnEnv() : covenSpawnEnv();
  const located = await commandPathWithEnv(tool.binary, env, options.refresh);
  if (!located) {
    return {
      path: null,
      executablePath: null,
      executableVerified: false,
      version: null,
      packageName: null,
      packagePath: null,
    };
  }

  const launch = covenLaunchCommandForBinary(located);
  if (launch.unresolvedWindowsShim) {
    return {
      path: located,
      executablePath: null,
      executableVerified: false,
      version: null,
      packageName: null,
      packagePath: null,
      error: "launcher-unreadable",
    };
  }

  const executablePath = await resolvedExecutablePath(located);
  const identity = executablePath
    ? await packageIdentityForExecutable(executablePath, tool.binary)
    : null;
  try {
    const { stdout, stderr } = await execFileAsync(
      launch.command,
      [...launch.fixedArgs, ...tool.versionArgs],
      { env, timeout: 2500 },
    );
    const version = firstSemver(`${stdout}\n${stderr}`);
    return {
      path: located,
      executablePath,
      executableVerified: identity?.binaryVerified ?? false,
      version,
      packageName: identity?.name ?? null,
      packagePath: identity?.path ?? null,
      ...(version ? {} : { error: "version-probe-failed" as const }),
    };
  } catch {
    return {
      path: located,
      executablePath,
      executableVerified: identity?.binaryVerified ?? false,
      version: null,
      packageName: identity?.name ?? null,
      packagePath: identity?.path ?? null,
      error: executablePath ? "version-probe-failed" : "launcher-unreadable",
    };
  }
}

async function commandPathWithEnv(
  binary: string,
  env: NodeJS.ProcessEnv,
  refresh: boolean | undefined,
): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  const find = async (lookupEnv: NodeJS.ProcessEnv): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync(finder, [binary], {
        env: lookupEnv,
        timeout: 1500,
      });
      const lines = stdout.split(/\r?\n/);
      return process.platform === "win32"
        ? pickWindowsLauncher(lines)
        : lines.map((l) => l.trim()).find(Boolean) ?? null;
    } catch {
      return null;
    }
  };
  const found = await find(env);
  if (found || refresh) return found;
  return find(refreshCovenSpawnEnv());
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
  installed: InstalledTool | null | OpenCovenToolProbe,
  latestCheck: NpmLatestCheck,
): OpenCovenToolStatus {
  const latest = latestCheck.status === "verified" ? latestCheck.latest : null;
  const probe = installed && "executableVerified" in installed ? installed : null;
  const version = installed?.version ?? null;
  const installedPath = installed?.path ?? null;
  const executableVerified = probe ? probe.executableVerified : Boolean(installed);
  const packageVerified =
    probe
      ? probe.packageName === tool.packageName &&
        Boolean(probe.packagePath) &&
        Boolean(probe.executablePath) &&
        Boolean(probe.executableVerified)
      : Boolean(installed);
  const outdated =
    packageVerified && !!version && !!latest && compareSemver(latest, version) > 0;
  const compatible =
    packageVerified && !!version && compareSemver(version, tool.minimumVersion) >= 0;

  return {
    id: tool.id,
    label: tool.label,
    packageName: tool.packageName,
    binary: tool.binary,
    installed: !!installedPath,
    path: installedPath,
    executablePath: probe ? probe.executablePath : installedPath,
    current: version,
    latest,
    latestCheck,
    outdated,
    compatible,
    packageVerified,
    executableVerified,
    packagePath: probe ? probe.packagePath : null,
    discoveryError: probe ? probe.error ?? null : null,
    minimumVersion: tool.minimumVersion,
    installCommand: tool.installCommand,
    checkedAt: latestCheck.checkedAt,
  };
}

async function toolStatus(tool: ToolSpec): Promise<OpenCovenToolStatus> {
  const [probe, latestCheck] = await Promise.all([
    discoverOpenCovenTool(tool),
    checkNpmLatestVersion(tool),
  ]);
  return composeOpenCovenToolStatus(tool, probe, latestCheck);
}

export async function openCovenToolStatuses(): Promise<OpenCovenToolStatus[]> {
  return Promise.all(OPEN_COVEN_TOOLS.map(toolStatus));
}

export async function verifyOpenCovenToolInstall(
  id: OpenCovenToolId,
): Promise<OpenCovenToolVerification<OpenCovenToolId>> {
  const tool = OPEN_COVEN_TOOLS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error("unknown OpenCoven tool");

  const [probe, latestCheck] = await Promise.all([
    discoverOpenCovenTool(tool, { refresh: true }),
    checkNpmLatestVersion(tool, { env: refreshCovenSpawnEnv, refreshEnv: refreshCovenSpawnEnv }),
  ]);
  const latest = latestCheck.status === "verified" ? latestCheck.latest : null;
  return evaluateOpenCovenToolVerification(tool, probe, latest);
}
