import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { compareSemver } from "@/lib/app-update";
import {
  covenLaunchCommandForBinary,
  covenSpawnEnv,
  pickWindowsLauncher,
  refreshCovenSpawnEnv,
} from "@/lib/coven-bin";
import {
  evaluateOpenCovenToolVerification,
  type OpenCovenToolProbe,
  type OpenCovenToolVerification,
} from "@/lib/opencoven-tool-verification";

export type {
  OpenCovenToolProbe,
  OpenCovenToolVerification,
} from "@/lib/opencoven-tool-verification";

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
    // Scoped package only; bare "coven-code" on npm is a different,
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
export type OpenCovenToolSpec = (typeof OPEN_COVEN_TOOLS)[number];

type CommandPathResult = { path: string | null; error?: "lookup-failed" };

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
  options: { refresh?: boolean } = {},
): Promise<OpenCovenToolProbe> {
  const env = options.refresh ? refreshCovenSpawnEnv() : covenSpawnEnv();
  const located = await commandPath(tool.binary, { env, refresh: options.refresh });
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

  const executablePath = await resolvedExecutablePath(located.path);
  const identity = executablePath
    ? await packageIdentityForExecutable(executablePath, tool.binary)
    : null;
  const launch = covenLaunchCommandForBinary(located.path);
  try {
    const { stdout, stderr } = await execFileAsync(
      launch.command,
      [...launch.fixedArgs, ...tool.versionArgs],
      { env, timeout: 2500 },
    );
    const version = firstSemver(`${stdout}\n${stderr}`);
    return {
      path: located.path,
      executablePath,
      executableVerified: identity?.binaryVerified ?? false,
      version,
      packageName: identity?.name ?? null,
      packagePath: identity?.path ?? null,
      ...(version ? {} : { error: "version-probe-failed" as const }),
    };
  } catch {
    return {
      path: located.path,
      executablePath,
      executableVerified: identity?.binaryVerified ?? false,
      version: null,
      packageName: identity?.name ?? null,
      packagePath: identity?.path ?? null,
      error: executablePath ? "version-probe-failed" : "launcher-unreadable",
    };
  }
}

async function latestVersion(
  tool: OpenCovenToolSpec,
  env: NodeJS.ProcessEnv = covenSpawnEnv(),
): Promise<string | null> {
  const npm = await commandPath("npm", { env });
  if (!npm.path) return null;
  try {
    const { stdout } = await execFileAsync(
      npm.path,
      ["view", tool.packageName, "version", "--json"],
      { env, timeout: 5000, shell: process.platform === "win32" },
    );
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === "string" ? firstSemver(parsed) : null;
  } catch {
    return null;
  }
}

async function toolStatus(tool: OpenCovenToolSpec): Promise<OpenCovenToolStatus> {
  const env = covenSpawnEnv();
  const [probe, latest] = await Promise.all([
    discoverOpenCovenTool(tool),
    latestVersion(tool, env),
  ]);
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
    outdated,
    compatible,
    packageVerified,
    executableVerified: probe.executableVerified,
    packagePath: probe.packagePath,
    discoveryError: probe.error ?? null,
    minimumVersion: tool.minimumVersion,
    installCommand: tool.installCommand,
    checkedAt: new Date().toISOString(),
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
  const [probe, latest] = await Promise.all([
    discoverOpenCovenTool(tool, { refresh: true }),
    latestVersion(tool, env),
  ]);
  return evaluateOpenCovenToolVerification(tool, probe, latest);
}

export async function openCovenToolStatuses(): Promise<OpenCovenToolStatus[]> {
  return Promise.all(OPEN_COVEN_TOOLS.map(toolStatus));
}
