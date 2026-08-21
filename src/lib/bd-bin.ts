// bd-bin: resolve the Beads CLI (`bd`) into a spawn-safe launch command.
//
// Why this exists. npm installs `bd` as three launchers under %APPDATA%\npm on
// Windows — an extensionless POSIX script, `bd.cmd`, and `bd.ps1`. There is no
// `bd.exe`. Node's `spawnSync` without `shell: true` goes straight to
// CreateProcess, which only appends `.exe` and cannot execute a batch file at
// all, so every `spawnSync("bd", …)` under scripts/ died with:
//
//   spawnSync bd ENOENT
//
// That is not cosmetic. `pnpm beads:worktrees:create` was unusable on Windows,
// which pushes sessions onto the unmanaged `git worktree add` fallback — and a
// worktree created that way carries no lifecycle metadata, so the retirement
// patrol classifies it `uncertain` forever and can never retire it. CLAUDE.md
// documents that failure mode at length.
//
// Why not `shell: true`. It would work, and it would route argv through
// cmd.exe. The argv these callers build is not fixed text: bead ids, titles,
// `--purpose` prose, branch names, and `--append-notes` bodies all flow into
// it, and cmd.exe re-parses `&`, `|`, `^`, `>`, `%` and quotes out of those
// strings. Node's own shell mode does not quote per-argument, so the fix would
// trade an ENOENT for a quoting and injection hazard on exactly the arguments
// most likely to contain metacharacters.
//
// What this does instead. Find the real launcher on PATH; when it turns out to
// be a `.cmd`/`.bat` npm shim, read the shim to recover the JavaScript entry
// point it invokes and spawn `node <entry>` directly — the same resolution
// `coven`, `codex`, and `openclaw` already use here
// (`windowsShimLaunchCommandForBinary`). No shell is ever involved, so argv
// keeps exact array semantics on every platform, and callers pass untrusted
// strings safely.
//
// On non-Windows this is deliberately a no-op: the command stays the bare name
// `bd` and the OS resolves it on PATH, so CI (and every test that puts a fake
// `bd` on PATH) behaves exactly as before.

import { statSync } from "node:fs";
import path from "node:path";
import { windowsShimLaunchCommandForBinary } from "./coven-bin.ts";

export type BdLaunchCommand = {
  /** argv[0] to hand to spawn/execFile. */
  command: string;
  /** Arguments that must precede the caller's own argv (e.g. a script path). */
  fixedArgs: string[];
  /** A .cmd/.bat shim was found but its target could not be proven. */
  unresolvedWindowsShim?: true;
};

export type BdBinDependencies = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  isFile?: (candidate: string) => boolean;
  resolveShim?: (binary: string, platform: NodeJS.Platform) => BdLaunchCommand;
  warn?: (message: string) => void;
};

/**
 * Launcher names to try inside one directory, in order.
 *
 * `.exe`/`.com` first because those are directly spawnable; then the npm
 * `.cmd`/`.bat` shims, which this module resolves into a `node <entry>` spawn;
 * the extensionless POSIX script last, because Windows cannot execute it and
 * it is only ever a better answer than giving up. The ordering is *within* a
 * directory, never across directories — hopping to a later PATH entry's `.exe`
 * ahead of an earlier npm shim can launch a stale or unrelated program.
 */
export const BD_WINDOWS_LAUNCHER_NAMES = ["bd.exe", "bd.com", "bd.cmd", "bd.bat", "bd"] as const;

const BD_BIN_ENV_KEY = "BD_BIN";

/** Join and split with the *target* platform's rules, not the host's. In
 *  production these are the same; in tests the platform is injected, and a
 *  host `path.join` would build `C:\...\npm/bd.cmd` on Linux and a host
 *  `path.delimiter` would split a Windows PATH on `:` — right after the drive
 *  letter. coven-bin's verifiedAbsoluteBinary picks its API the same way. */
function pathApiFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function defaultIsFile(candidate: string): boolean {
  try {
    const stat = statSync(candidate);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Directories to probe for a `bd` launcher, PATH first.
 *
 * PATH order is authoritative — an explicitly installed `bd` earlier on PATH
 * must win over the npm global prefix. The npm directories are appended, not
 * prepended, so they only rescue a minimal PATH (a GUI-launched process, a
 * stripped CI env) rather than overriding a deliberate one.
 */
export function bdSearchDirs(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const pathApi = pathApiFor(platform);
  const fromPath = (env.PATH ?? env.Path ?? "").split(pathApi.delimiter);
  const npmDirs =
    platform === "win32"
      ? [
          env.APPDATA ? pathApi.join(env.APPDATA, "npm") : null,
          env.npm_config_prefix ?? null,
        ]
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

function launchForBinary(
  binary: string,
  platform: NodeJS.Platform,
  resolveShim: NonNullable<BdBinDependencies["resolveShim"]>,
): BdLaunchCommand {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(binary)) {
    return { command: binary, fixedArgs: [] };
  }
  return resolveShim(binary, platform);
}

/**
 * Resolve `bd` into something spawn can actually execute, without a shell.
 *
 * Order: an explicit `BD_BIN` override, then a PATH probe on Windows, then the
 * bare name. A `BD_BIN` that does not name a readable file is reported and
 * ignored rather than obeyed — a typo there should not disable Beads.
 */
export function resolveBdLaunchCommand(
  dependencies: BdBinDependencies = {},
): BdLaunchCommand {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const isFile = dependencies.isFile ?? defaultIsFile;
  const resolveShim =
    dependencies.resolveShim ??
    ((binary, shimPlatform) =>
      windowsShimLaunchCommandForBinary(binary, shimPlatform) as BdLaunchCommand);

  const override = env[BD_BIN_ENV_KEY]?.trim();
  if (override) {
    if (isFile(override)) return launchForBinary(override, platform, resolveShim);
    (dependencies.warn ?? ((message: string) => console.error(message)))(
      `[bd-bin] ignoring ${BD_BIN_ENV_KEY}=${override} - not a readable file; falling back to discovery`,
    );
  }

  // POSIX spawn resolves a bare name on PATH and can execute the script npm
  // installs, so there is nothing to fix and nothing to risk changing.
  if (platform !== "win32") return { command: "bd", fixedArgs: [] };

  const pathApi = pathApiFor(platform);
  for (const dir of bdSearchDirs(env, platform)) {
    for (const name of BD_WINDOWS_LAUNCHER_NAMES) {
      const candidate = pathApi.join(dir, name);
      if (!isFile(candidate)) continue;
      return launchForBinary(candidate, platform, resolveShim);
    }
  }

  // Nothing found. Return the bare name so the caller's existing error path
  // reports the same ENOENT it always did, rather than a novel message.
  return { command: "bd", fixedArgs: [] };
}

let cached: BdLaunchCommand | null = null;

/** Process-wide cached resolution for the real environment. */
export function bdLaunchCommand(): BdLaunchCommand {
  cached ??= resolveBdLaunchCommand();
  return cached;
}

/** Exported for tests; discovery is cheap but not free to repeat. */
export function resetBdLaunchCommandCache(): void {
  cached = null;
}

/**
 * Route one `spawnSync`/`execFileSync` call through the resolver.
 *
 * Call sites keep writing `"bd"` as the executable — that literal is what
 * several source-level guards read — and this translates it at the spawn
 * boundary. Any other executable passes through untouched.
 */
export function withBdLaunch(
  executable: string,
  args: readonly string[],
  launch: BdLaunchCommand = bdLaunchCommand(),
): { command: string; args: string[] } {
  if (executable !== "bd") return { command: executable, args: [...args] };
  return { command: launch.command, args: [...launch.fixedArgs, ...args] };
}
