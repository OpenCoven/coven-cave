import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import path, { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { compareSemver } from "./app-update.ts";
import {
  openCovenToolState,
  type OpenCovenToolState,
} from "./opencoven-tools-state.ts";
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
    minimumVersion: "0.1.1",
    installCommand: "npm i -g @opencoven/cli@latest",
  },
] as const;

export type OpenCovenToolId = (typeof OPEN_COVEN_TOOLS)[number]["id"];
export type OpenCovenToolSpec = (typeof OPEN_COVEN_TOOLS)[number];

type CommandPathResult = { path: string | null; error?: "lookup-failed" };

export type NpmLatestCheckError =
  | "npm_unavailable"
  | "runtime_error"
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
  state: OpenCovenToolState;
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

async function commandPath(
  binary: string,
  options: { env?: NodeJS.ProcessEnv; refresh?: boolean } = {},
): Promise<CommandPathResult> {
  const finder = process.platform === "win32" ? "where" : "which";
  const find = async (env: NodeJS.ProcessEnv): Promise<CommandPathResult> => {
    try {
      const { stdout } = await execFileAsync(finder, [binary], { env, timeout: 1500 });
      const lines = stdout.split(/\r?\n/);
      return {
        path:
          process.platform === "win32"
            ? pickWindowsLauncher(lines)
            : lines.map((line) => line.trim()).find(Boolean) ?? null,
      };
    } catch (err) {
      // `which`/`where` use exit code 1 for the ordinary not-found case.
      // Reserve an error marker for a genuinely failed lookup so callers can
      // still refresh a desktop app's stale PATH after an install.
      if ((err as { code?: unknown }).code === 1) return { path: null };
      return { path: null, error: "lookup-failed" };
    }
  };

  const env = options.env ?? (options.refresh ? refreshCovenSpawnEnv() : covenSpawnEnv());
  const found = await find(env);
  if (found.path || found.error || options.refresh || options.env) return found;

  // A desktop Cave may have started before an installer added a new bin dir.
  // Normal status checks get one fresh retry on a miss; post-install checks
  // request a refresh up front so they never trust the pre-install PATH.
  return find(refreshCovenSpawnEnv());
}

async function resolvedExecutablePath(binaryPath: string): Promise<string | null> {
  const launch = covenLaunchCommandForBinary(binaryPath);
  if (launch.unresolvedWindowsShim) return null;
  if (launch.command === process.execPath && launch.fixedArgs[0]) {
    return launch.fixedArgs[0];
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
  return normalize(resolve(left)) === normalize(resolve(right));
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
  let directory = dirname(executablePath);
  for (let depth = 0; depth < 16; depth += 1) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
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
          const expectedPath = resolve(directory, binPath);
          try {
            binaryVerified = samePath(await realpath(expectedPath), executablePath);
          } catch {
            binaryVerified = samePath(expectedPath, executablePath);
          }
        }
        return { name: manifest.name, path: directory, binaryVerified };
      }
    } catch {
      // Keep walking: global npm packages place package.json above the bin
      // script, while unrelated launchers frequently have none at all.
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

export async function discoverOpenCovenTool(
  tool: OpenCovenToolSpec,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<OpenCovenToolProbe> {
  const env = options.env ?? refreshCovenSpawnEnv();
  const located = await commandPath(tool.binary, { env });
  if (!located.path) {
    return {
      path: null,
      executablePath: null,
      executableVerified: false,
      version: null,
      packageName: null,
      packagePath: null,
    };
  }
  return probeOpenCovenBinaryAt(tool, located.path, env);
}

/** Probe one explicit launcher path (no PATH lookup): resolve its executable
 *  target, attribute it to an npm package, and read its version. Shared by
 *  PATH discovery above and by stale-launcher remediation, which must verify
 *  a fresh npm-prefix copy at a known location before touching anything. */
export async function probeOpenCovenBinaryAt(
  tool: Pick<OpenCovenToolSpec, "binary" | "versionArgs">,
  binaryPath: string,
  env: NodeJS.ProcessEnv = refreshCovenSpawnEnv(),
): Promise<OpenCovenToolProbe> {
  const executablePath = await resolvedExecutablePath(binaryPath);
  const identity = executablePath
    ? await packageIdentityForExecutable(executablePath, tool.binary)
    : null;
  const launch = covenLaunchCommandForBinary(binaryPath);
  if (launch.unresolvedWindowsShim) {
    return {
      path: binaryPath,
      executablePath: null,
      executableVerified: false,
      version: null,
      packageName: null,
      packagePath: null,
      error: "launcher-unreadable",
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      launch.command,
      [...launch.fixedArgs, ...tool.versionArgs],
      { env, timeout: 2500 },
    );
    const version = firstSemver(`${stdout}\n${stderr}`);
    return {
      path: binaryPath,
      executablePath,
      executableVerified: identity?.binaryVerified ?? false,
      version,
      packageName: identity?.name ?? null,
      packagePath: identity?.path ?? null,
      ...(version ? {} : { error: "version-probe-failed" as const }),
    };
  } catch {
    return {
      path: binaryPath,
      executablePath,
      executableVerified: identity?.binaryVerified ?? false,
      version: null,
      packageName: identity?.name ?? null,
      packagePath: identity?.path ?? null,
      error: executablePath ? "version-probe-failed" : "launcher-unreadable",
    };
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
export function npmLaunchCommandForPath(
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

// Backward-compatible name retained for the latest-version callers that
// introduced this helper. Install and registry operations share the same safe
// Windows npm launch path.
export const npmViewLaunchCommandForPath = npmLaunchCommandForPath;

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
  const details = err as {
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  } | undefined;
  const code = details?.code;
  const message = [
    err instanceof Error ? err.message : String(err),
    typeof details?.stderr === "string" ? details.stderr : "",
    typeof details?.stdout === "string" ? details.stdout : "",
  ].filter(Boolean).join("\n");
  if (code === "ENOENT") return "npm_unavailable";
  if (
    code === "ETIMEDOUT" ||
    (details?.killed === true && details.signal === "SIGTERM") ||
    /timed?\s*out/i.test(message)
  ) {
    return "timeout";
  }
  if (
    code === "ENOEXEC" ||
    code === "ELIBACC" ||
    code === "ELIBBAD" ||
    /error while loading shared libraries|library not loaded|exec format error|cannot execute binary file|bad cpu type in executable|not a valid win32 application/i.test(
      message,
    )
  ) {
    return "runtime_error";
  }
  return "registry_error";
}

/**
 * Read an allowlisted package's npm latest tag. A lookup failure remains
 * best-effort, but is represented explicitly so callers can never mistake an
 * unknown latest version for a confirmed current version.
 */
export async function checkNpmLatestVersion(
  tool: Pick<OpenCovenToolSpec, "packageName">,
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
    ? npmLaunchCommandForPath(npmPath, platform, dependencies.fileExists)
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
  tool: OpenCovenToolSpec,
  probe: OpenCovenToolProbe,
  latestCheck: NpmLatestCheck,
): OpenCovenToolStatus {
  const latest = latestCheck.status === "verified" ? latestCheck.latest : null;
  const packageVerified =
    probe.packageName === tool.packageName &&
    Boolean(probe.packagePath) &&
    Boolean(probe.executablePath) &&
    probe.executableVerified;
  const outdated =
    packageVerified &&
    !!probe.version &&
    !!latest &&
    compareSemver(latest, probe.version) > 0;
  const compatible =
    packageVerified &&
    !!probe.version &&
    compareSemver(probe.version, tool.minimumVersion) >= 0;
  // The six-state model reads the verified probe facts: an unverified package
  // or failed version probe can never present as current/compatible.
  const state = openCovenToolState({
    installed: !!probe.path,
    current: probe.version,
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
    installed: !!probe.path,
    path: probe.path,
    executablePath: probe.executablePath,
    current: probe.version,
    latest,
    latestCheck,
    outdated,
    compatible,
    packageVerified,
    executableVerified: probe.executableVerified,
    packagePath: probe.packagePath,
    discoveryError: probe.error ?? null,
    state,
    minimumVersion: tool.minimumVersion,
    installCommand: tool.installCommand,
    checkedAt: latestCheck.checkedAt,
  };
}

export async function verifyOpenCovenToolInstall(
  id: OpenCovenToolId,
): Promise<OpenCovenToolVerification<OpenCovenToolId>> {
  const tool = OPEN_COVEN_TOOLS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error("unknown OpenCoven tool");

  // Rebuild PATH before both discovery and registry lookup. This is the
  // authoritative post-install check: it must not inherit the pre-install
  // cache that made a stale launcher look like a successful update.
  const env = refreshCovenSpawnEnv();
  const [probe, latestCheck] = await Promise.all([
    discoverOpenCovenTool(tool, { env }),
    checkNpmLatestVersion(tool, { env: () => env, refreshEnv: () => env }),
  ]);
  const latest = latestCheck.status === "verified" ? latestCheck.latest : null;
  return evaluateOpenCovenToolVerification(tool, probe, latest);
}

async function toolStatus(
  tool: OpenCovenToolSpec,
  env: NodeJS.ProcessEnv,
): Promise<OpenCovenToolStatus> {
  const [probe, latestCheck] = await Promise.all([
    discoverOpenCovenTool(tool, { env }),
    checkNpmLatestVersion(tool, { env: () => env, refreshEnv: () => env }),
  ]);
  return composeOpenCovenToolStatus(tool, probe, latestCheck);
}

export async function openCovenToolStatuses(): Promise<OpenCovenToolStatus[]> {
  const env = refreshCovenSpawnEnv();
  return Promise.all(OPEN_COVEN_TOOLS.map((tool) => toolStatus(tool, env)));
}
