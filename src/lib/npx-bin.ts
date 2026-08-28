// Spawn-safe npx launcher resolution for the Skills directory routes.
//
// npm installs npx as npx.cmd on Windows with no npx.exe, so execFile("npx")
// fails ENOENT there and both Skills directory routes were dead. Windows .cmd
// shims cannot be executed directly and must not be routed through cmd.exe —
// the args include user-supplied skill names, and a shell would re-parse them
// (cave-4arof). Resolve the shim's JavaScript target and invoke Node directly,
// the same contract bd-bin.ts uses for `bd`.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { windowsShimLaunchCommandForBinary } from "./coven-bin.ts";

export type NpxLaunchCommand = {
  command: string;
  fixedArgs: string[];
  /** True when a Windows shim was found but its target could not be proven. */
  unresolvedWindowsShim?: boolean;
};

export const NPX_WINDOWS_LAUNCHER_NAMES = [
  "npx.exe",
  "npx.com",
  "npx.cmd",
  "npx.bat",
  "npx",
] as const;

function isFile(candidate: string): boolean {
  try {
    const stats = statSync(/* turbopackIgnore: true */ candidate);
    return stats.isFile() || stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Join and split with the target platform's rules, never the host's. */
function pathApiFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Directories to probe for an npx launcher, PATH first. PATH order is
 * authoritative; the npm directories are appended so they only rescue a
 * minimal PATH (a GUI-launched process, a stripped CI env).
 */
function npxSearchDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const pathApi = pathApiFor(platform);
  const fromPath = (env.PATH ?? env.Path ?? "").split(pathApi.delimiter);
  const npmDirs =
    platform === "win32"
      ? [env.APPDATA ? pathApi.join(env.APPDATA, "npm") : null, env.npm_config_prefix ?? null]
      : [];
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of [...fromPath, ...npmDirs]) {
    const trimmed = dir?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    dirs.push(trimmed);
  }
  return dirs;
}

/**
 * Recover the JavaScript entry from a modern npm npx shim.
 *
 * npm 9+ writes npx.cmd in the variable-assignment form:
 *
 *   SET "NPX_CLI_JS=%~dp0\node_modules\npm\bin\px-cli.js"
 *   ...
 *   "%NODE_EXE%" "%NPX_CLI_JS%" %*
 *
 * The generic shim parser skips SET lines and only follows the older literal
 * %~dp0 invocation form, so it cannot see this one. The last static %~dp0
 * assignment is npm's default entry; the NPM_PREFIX override is computed at
 * runtime and cannot be resolved without executing the shim, so it is never
 * trusted. Returns null when no assignment resolves to an existing file.
 */
export function npxCliEntryFromShim(
  shimPath: string,
  file: (candidate: string) => boolean,
): string | null {
  let text: string;
  try {
    text = readFileSync(/* turbopackIgnore: true */ shimPath, "utf-8");
  } catch {
    return null;
  }
  const binDir = path.dirname(shimPath);
  const assignments: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    // Lines of the form: SET "VAR=%~dp0\node_modules\npm\bin\px-cli.js"
    const match = /^\s*SET\s+"[A-Za-z_][A-Za-z0-9_]*=(.+)"\s*$/i.exec(line);
    if (!match) continue;
    const value = match[1]!;
    // Only the static %~dp0 form is recoverable; the runtime NPM_PREFIX
    // override form is skipped below because it has no %~dp0 prefix.
    const prefixed = /^%~?dp0%?[\\/]+/.exec(value);
    if (!prefixed) continue;
    assignments.push(value.slice(prefixed[0].length).replace(/[\\/]+/g, path.sep));
  }
  // Prefer the last assignment (npm's default entry) but accept any earlier
  // one that names an existing file — a relocated prefix can invalidate the
  // default while an earlier static path still works.
  for (const target of [...assignments].reverse()) {
    const candidate = path.resolve(/* turbopackIgnore: true */ binDir, target);
    if (file(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve npx into something execFile can actually execute, without a shell.
 * POSIX keeps the bare name (spawn resolves it on PATH and executes the
 * script npm installs); Windows probes PATH (then the npm global prefix) for
 * a direct executable first and falls back to resolving the .cmd shim into a
 * shell-free `node <entry>` spawn.
 */
export function resolveNpxLaunchCommand(
  dependencies: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    isFile?: (candidate: string) => boolean;
    resolveShim?: (binary: string, platform: NodeJS.Platform) => NpxLaunchCommand;
  } = {},
): NpxLaunchCommand {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const file = dependencies.isFile ?? isFile;
  const resolveShim =
    dependencies.resolveShim ??
    ((binary, shimPlatform) =>
      windowsShimLaunchCommandForBinary(binary, shimPlatform) as NpxLaunchCommand);
  if (platform !== "win32") {
    return { command: "npx", fixedArgs: [] };
  }
  const pathApi = pathApiFor(platform);
  for (const dir of npxSearchDirs(env, platform)) {
    for (const name of NPX_WINDOWS_LAUNCHER_NAMES) {
      const candidate = pathApi.join(dir, name);
      if (!file(candidate)) continue;
      if (name === "npx.exe" || name === "npx.com") {
        return { command: candidate, fixedArgs: [] };
      }
      const launch = resolveShim(candidate, platform);
      if (!launch.unresolvedWindowsShim) {
        return { command: launch.command, fixedArgs: launch.fixedArgs };
      }
      // The generic parser only follows the older literal %~dp0 invocation
      // form; modern npm npx shims assign the entry to a variable. Recover it
      // directly and verify the entry exists before trusting it.
      const recovered = npxCliEntryFromShim(candidate, file);
      if (recovered) {
        return { command: process.execPath, fixedArgs: [recovered] };
      }
      // An unprovable shim must not win: a later PATH entry may carry a
      // directly executable npx, and cmd.exe is never an option here.
    }
  }
  // Nothing spawnable found on Windows: fall back to the bare name so the
  // failure is the ordinary ENOENT the route already reports.
  return { command: "npx", fixedArgs: [] };
}
