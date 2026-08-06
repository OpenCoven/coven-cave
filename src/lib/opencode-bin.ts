import { statSync } from "node:fs";
import path from "node:path";
import {
  windowsShimLaunchCommandForBinary,
  type CovenLaunchCommand,
} from "./coven-bin.ts";
import { harnessSpawnEnv } from "./harness-spawn-env.ts";
import type { RuntimeAvailabilityProbe, StatFileFn } from "./runtime-availability.ts";

/** OpenCode is installed as `opencode` on all supported desktop platforms. */
export function openCodeCommand(): string {
  return "opencode";
}

export type OpenCodeLaunch = {
  command: string;
  args: string[];
  unresolvedWindowsShim?: true;
  resolutionFailed?: true;
  requiredFiles?: readonly string[];
};

/** Resolution metadata is a hard no-spawn boundary for every OpenCode caller. */
export function isOpenCodeLaunchSpawnable(launch: OpenCodeLaunch): boolean {
  return launch.unresolvedWindowsShim !== true && launch.resolutionFailed !== true;
}

type OpenCodeLaunchOptions = {
  statFile?: StatFileFn;
  resolveWindowsShim?: (
    binary: string,
    platform?: NodeJS.Platform,
  ) => CovenLaunchCommand;
};

type OpenCodeWindowsResolution = CovenLaunchCommand & {
  resolutionFailed?: true;
  requiredFiles?: readonly string[];
};

function isMissingCandidateError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function windowsPathEntries(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? env.Path ?? env.path ?? "")
    .split(";")
    .filter(Boolean)
    .slice(0, 512);
}

function windowsCandidateNames(env: NodeJS.ProcessEnv): string[] {
  const supported = new Set([".com", ".exe", ".bat", ".cmd"]);
  const names = new Set<string>();
  for (const extension of (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")) {
    if (!supported.has(extension.toLowerCase())) continue;
    names.add(`opencode${extension}`);
    names.add(`opencode${extension.toLowerCase()}`);
  }
  return [...names];
}

function resolveOpenCodeWindowsLaunch(
  env: NodeJS.ProcessEnv,
  options: OpenCodeLaunchOptions,
): OpenCodeWindowsResolution {
  const statFile = options.statFile
    ?? ((candidate: string) => statSync(/* turbopackIgnore: true */ candidate).isFile());
  const resolveWindowsShim =
    options.resolveWindowsShim ?? windowsShimLaunchCommandForBinary;
  const exists = (candidate: string): boolean => {
    try {
      return statFile(candidate);
    } catch (error) {
      if (isMissingCandidateError(error)) return false;
      throw error;
    }
  };

  try {
    for (const directory of windowsPathEntries(env)) {
      for (const name of windowsCandidateNames(env)) {
        const candidate = path.win32.join(/* turbopackIgnore: true */ directory, name);
        if (!exists(candidate)) continue;
        if (/\.(?:exe|com)$/i.test(candidate)) {
          return { command: candidate, fixedArgs: [] };
        }
        const launch = resolveWindowsShim(candidate, "win32");
        if (launch.unresolvedWindowsShim) return launch;
        return {
          ...launch,
          ...(launch.fixedArgs.length > 0
            ? { requiredFiles: [launch.fixedArgs.at(-1)!] }
            : {}),
        };
      }

      // npm normally creates a .cmd beside these files. If only an
      // extensionless POSIX shim or a PowerShell shim remains, do not skip to a
      // lower-priority PATH entry and silently launch a different install.
      for (const unsafeName of ["opencode.ps1", "opencode"]) {
        const candidate = path.win32.join(/* turbopackIgnore: true */ directory, unsafeName);
        if (exists(candidate)) {
          return {
            command: candidate,
            fixedArgs: [],
            unresolvedWindowsShim: true,
          };
        }
      }
    }
  } catch {
    return {
      command: "opencode.exe",
      fixedArgs: [],
      resolutionFailed: true,
    };
  }

  return { command: "opencode.exe", fixedArgs: [] };
}

/**
 * Npm installs OpenCode behind command-shell shims on Windows. Both `.cmd`
 * (`%*`) and the generated PowerShell wrapper reserialize prompt-bearing argv,
 * which can rewrite quotes and metacharacters. Resolve the npm shim's proven
 * package target passively, then let Node spawn that native executable (or
 * legacy Node script) directly with an argv array.
 */
export function openCodeLaunch(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: OpenCodeLaunchOptions = {},
): OpenCodeLaunch {
  if (platform !== "win32") return { command: openCodeCommand(), args: [...args] };
  const resolution = resolveOpenCodeWindowsLaunch(env, options);
  return {
    command: resolution.command,
    args: [...resolution.fixedArgs, ...args],
    ...(resolution.unresolvedWindowsShim
      ? { unresolvedWindowsShim: true as const }
      : {}),
    ...(resolution.resolutionFailed
      ? { resolutionFailed: true as const }
      : {}),
    ...(resolution.requiredFiles
      ? { requiredFiles: resolution.requiredFiles }
      : {}),
  };
}

/**
 * Canonical availability probe for OpenCode's resolved launch plan (#3862).
 *
 * Callers hand in the EXACT launch plan and environment they are about to
 * spawn, so preflight and launch cannot drift. Windows shim resolution already
 * produced a direct, shell-free command; this mapper carries its failure and
 * required-target metadata into the shared passive availability contract. The
 * user prompt is never an input, so availability is identical for any argv.
 */
export function openCodeAvailabilityProbe(
  launch: OpenCodeLaunch,
  env: NodeJS.ProcessEnv,
  options: { platform?: NodeJS.Platform; statFile?: StatFileFn } = {},
): RuntimeAvailabilityProbe {
  return {
    runner: "opencode",
    command: launch.command,
    env,
    unresolvedWindowsShim: launch.unresolvedWindowsShim === true,
    resolutionFailed: launch.resolutionFailed === true,
    requiredFiles: launch.requiredFiles,
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.statFile !== undefined ? { statFile: options.statFile } : {}),
  };
}

/**
 * OpenCode needs an XDG runtime directory on POSIX. WSL can inherit a stale
 * Windows-login path, while a native macOS/Linux login may already provide a
 * valid one. Windows does not use this convention.
 */
export function openCodeNeedsTmpRuntimeDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean {
  const isWsl = platform === "linux" && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  return isWsl || (platform !== "win32" && !env.XDG_RUNTIME_DIR);
}

/** Prefer the process launch PATH while retaining the scoped harness fallback.
 * This keeps a freshly updated user npm shim ahead of Cave's discovered CLI
 * directories without importing that dynamic discovery into the sidecar. */
export function preferOpenCodeLaunchPath(
  scopedPath: string | undefined,
  launchPath: string | undefined = process.env.PATH ?? process.env.Path,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const delimiter = platform === "win32" ? ";" : ":";
  const seen = new Set<string>();
  const normalize = (entry: string) => platform === "win32" ? entry.toLowerCase() : entry;
  const entries = [launchPath, scopedPath]
    .flatMap((pathValue) => pathValue?.split(delimiter) ?? [])
    .filter((entry) => entry && !seen.has(normalize(entry)) && (seen.add(normalize(entry)), true));
  return entries.length ? entries.join(delimiter) : undefined;
}

/**
 * Preserve the familiar's scoped vault environment while making WSL's CLI
 * runnable outside a login session. The snap/node launcher rejects the absent
 * `/run/user/<uid>` directory; `/tmp` is sufficient for OpenCode's ephemeral
 * local runtime files and is never sent to a remote host.
 */
export function openCodeSpawnEnv(familiarId?: string | null): NodeJS.ProcessEnv {
  const env = harnessSpawnEnv(familiarId);
  // OpenCode is direct user-selected tooling: preserve its scoped fallback,
  // but order the actual launch PATH first so a newly updated npm shim cannot
  // be shadowed by an older discovered global copy.
  const launchPath = preferOpenCodeLaunchPath(env.PATH);
  if (launchPath) env.PATH = launchPath;
  if (openCodeNeedsTmpRuntimeDir(process.platform, env)) {
    env.XDG_RUNTIME_DIR = "/tmp";
  }
  return env;
}
