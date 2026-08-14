// coven-bin: resolve the `coven` binary and spawn env for child processes.
//
// Why this exists: when the Tauri-bundled cave .app is launched from Finder
// or Spotlight, macOS gives it a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
// Interactive-only shell setup (nvm, fnm, asdf, …) isn't applied, so the
// up-to-date `coven` symlinked into ~/.nvm/versions/node/<v>/bin doesn't get
// found — and if a stale Rust-installed `coven` lives at ~/.cargo/bin (or
// /usr/local/bin) it gets picked instead, often missing flags the cave
// relies on (--stream-json, --continue, etc.) and producing cryptic clap
// errors.
//
// Strategy:
//   1. Probe a small list of well-known coven install locations in priority
//      order (nvm/fnm node bin dirs, Windows npm global shims, pnpm global,
//      bun global, homebrew, ~/.local/bin, /usr/local/bin, then ~/.cargo/bin
//      as a last resort because it tends to be the stale one).
//   2. If none exist, fall back to the user's login-shell PATH by exec-ing
//      `$SHELL -ilc 'echo $PATH'` so anything the user has in their interactive
//      profile (custom rc edits, asdf, mise, etc.) still works.
//   3. Cache the result for the lifetime of the server process.
//
// Cave call sites that execute `coven` with dynamic argv should use
// `covenLaunchCommand()` for argv[0] plus fixed args, and `covenSpawnEnv()`
// for the env option.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scrubSidecarInternalEnv,
  vaultFreeDiscoveryEnv,
} from "./child-spawn-env.ts";
import { managedNodePaths, managedNodeSpawnEnv } from "./server/managed-node-toolchain.ts";
import { loadVaultMap } from "./vault.ts";

export { scrubSidecarInternalEnv } from "./child-spawn-env.ts";

let cachedBin: string | null = null;
let cachedPath: string | null = null;
let cachedToolPath: string | null = null;

export type CovenLaunchCommand = {
  command: string;
  fixedArgs: string[];
  /** Resolution exceeded a bounded discovery deadline; callers must not spawn. */
  resolutionTimedOut?: true;
  // A .cmd/.bat shim was found but its target could not be proven. Callers
  // that only need a version must report it as unknown instead of asking
  // Windows to run an ambiguous batch file (or substituting another binary).
  unresolvedWindowsShim?: true;
};

export type CovenSpawnEnvOptions = {
  /** Credential-free source env used only by PATH discovery subprocesses. */
  discoveryEnv?: NodeJS.ProcessEnv;
  /** Absolute timestamp after which no new discovery subprocess may start. */
  discoveryDeadline?: number;
  /** Clock seam for absolute discovery deadlines. */
  now?: () => number;
};

type DiscoveryOptions = {
  env: NodeJS.ProcessEnv;
  deadline?: number;
  now: () => number;
};

function discoveryOptions(options: CovenSpawnEnvOptions = {}): DiscoveryOptions {
  return {
    env: options.discoveryEnv ??
      vaultFreeDiscoveryEnv(process.env, loadVaultMap(true)),
    deadline: options.discoveryDeadline,
    now: options.now ?? Date.now,
  };
}

function remainingDiscoveryTimeout(
  maximum: number,
  deadline: number | undefined,
  now: () => number,
): number {
  if (deadline === undefined) return maximum;
  return Math.min(maximum, deadline - now());
}

const HOME = os.homedir();

type NodeRuntimeProbe = (
  command: string,
  args: string[],
  options: {
    timeout: number;
    stdio: "ignore";
    windowsHide: boolean;
    env: NodeJS.ProcessEnv;
    shell?: boolean;
  },
) => unknown;

/**
 * Keep only version-manager directories whose Node runtime can actually
 * start and which carry an npm launcher. A half-removed or incompatible
 * newer NVM/FNM install must not poison every Cave child process merely
 * because its directory still exists.
 */
export function runnableNodeToolchainDirs(
  directories: readonly string[],
  dependencies: {
    platform?: NodeJS.Platform;
    exists?: (file: string) => boolean;
    probe?: NodeRuntimeProbe;
    env?: NodeJS.ProcessEnv;
    deadline?: number;
    now?: () => number;
  } = {},
): string[] {
  const platform = dependencies.platform ?? process.platform;
  const exists = dependencies.exists ?? existsSync;
  const probe = dependencies.probe ?? execFileSync;
  const sourceEnv = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const nodeName = platform === "win32" ? "node.exe" : "node";
  const npmNames = platform === "win32" ? ["npm.cmd", "npm.exe", "npm"] : ["npm"];

  return directories.filter((directory) => {
    const node = path.join(/* turbopackIgnore: true */ directory, nodeName);
    const npmName = npmNames.find((name) => exists(path.join(/* turbopackIgnore: true */ directory, name)));
    if (!exists(node) || !npmName) {
      return false;
    }
    const npm = path.join(/* turbopackIgnore: true */ directory, npmName);
    const env = scrubSidecarInternalEnv({
      ...sourceEnv,
      PATH: [directory, sourceEnv.PATH].filter(Boolean).join(path.delimiter),
    });
    try {
      const nodeTimeout = remainingDiscoveryTimeout(1500, dependencies.deadline, now);
      if (nodeTimeout <= 0) return false;
      probe(node, ["--version"], {
        timeout: nodeTimeout,
        stdio: "ignore",
        windowsHide: true,
        env,
      });
      const npmTimeout = remainingDiscoveryTimeout(1500, dependencies.deadline, now);
      if (npmTimeout <= 0) return false;
      probe(npm, ["--version"], {
        timeout: npmTimeout,
        stdio: "ignore",
        windowsHide: true,
        env,
        shell: platform === "win32" && /\.(cmd|bat)$/i.test(npm),
      });
      return remainingDiscoveryTimeout(
        Number.POSITIVE_INFINITY,
        dependencies.deadline,
        now,
      ) > 0;
    } catch {
      return false;
    }
  });
}

function nodeNvmBinDirs(discovery: DiscoveryOptions): string[] {
  const nvmRoot = path.join(/* turbopackIgnore: true */ HOME, ".nvm", "versions", "node");
  if (!existsSync(/* turbopackIgnore: true */ nvmRoot)) return [];
  try {
    const directories = readdirSync(/* turbopackIgnore: true */ nvmRoot)
      .map((v) => path.join(/* turbopackIgnore: true */ nvmRoot, v, "bin"))
      .filter((d) => existsSync(/* turbopackIgnore: true */ d))
      .sort()
      .reverse(); // newest version first by lexicographic sort
    return runnableNodeToolchainDirs(directories, {
      env: discovery.env,
      deadline: discovery.deadline,
      now: discovery.now,
    });
  } catch {
    return [];
  }
}

function fnmBinDirs(discovery: DiscoveryOptions): string[] {
  const fnmRoot = path.join(/* turbopackIgnore: true */ HOME, ".fnm", "node-versions");
  if (!existsSync(/* turbopackIgnore: true */ fnmRoot)) return [];
  try {
    const directories = readdirSync(/* turbopackIgnore: true */ fnmRoot)
      .map((v) => path.join(/* turbopackIgnore: true */ fnmRoot, v, "installation", "bin"))
      .filter((d) => existsSync(/* turbopackIgnore: true */ d))
      .sort()
      .reverse();
    return runnableNodeToolchainDirs(directories, {
      env: discovery.env,
      deadline: discovery.deadline,
      now: discovery.now,
    });
  } catch {
    return [];
  }
}

function windowsNpmBinDirs(discovery: DiscoveryOptions): string[] {
  if (process.platform === "win32") {
    const dirs = [
      discovery.env.APPDATA
        ? path.join(/* turbopackIgnore: true */ discovery.env.APPDATA, "npm")
        : null,
      discovery.env.npm_config_prefix ?? null,
    ].filter((d): d is string => !!d && existsSync(/* turbopackIgnore: true */ d));
    return Array.from(new Set(dirs));
  }
  return [];
}

function candidateDirs(discovery = discoveryOptions()): string[] {
  const managed = managedNodePaths();
  return [
    // Cave's verified user-scoped Node/npm lane precedes opportunistic host
    // managers. It never edits system PATH; this only affects Cave children.
    managed?.npmBin,
    managed ? path.dirname(managed.node) : null,
    ...nodeNvmBinDirs(discovery),
    ...fnmBinDirs(discovery),
    ...windowsNpmBinDirs(discovery),
    path.join(/* turbopackIgnore: true */ HOME, "Library", "pnpm"),
    path.join(/* turbopackIgnore: true */ HOME, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(/* turbopackIgnore: true */ HOME, ".local", "bin"),
    // Grok Build's official installer uses ~/.grok/bin on macOS, Linux, and
    // Windows. A desktop app can start without the user's shell PATH, so keep
    // the direct runtime discoverable even when the installer could not add
    // its symlink or profile entry.
    path.join(/* turbopackIgnore: true */ HOME, ".grok", "bin"),
    // ~/.cargo/bin last: often holds a stale `cargo install` of coven that's
    // missing flags. Prefer the npm-published binary when both exist.
    path.join(/* turbopackIgnore: true */ HOME, ".cargo", "bin"),
  ].filter((d): d is string => !!d && existsSync(/* turbopackIgnore: true */ d));
}

/**
 * Pick the spawnable launcher from `where` output. npm's global installs
 * write three launchers per package (an extensionless POSIX script, a .cmd
 * shim, and a .ps1), and `where` lists the extensionless one first — but a
 * bare Windows spawn() can only execute .exe/.com, and a .cmd needs
 * covenLaunchCommandForBinary() to resolve its package target into a direct
 * native or `node <script>` spawn. Keep the order emitted by `where`, though:
 * it reflects PATH
 * precedence. Picking a later .exe over an earlier npm .cmd shim can launch a
 * stale or unrelated executable after an update.
 */
export function pickWindowsLauncher(lines: string[]): string | null {
  const candidates = lines.map((line) => line.trim()).filter(Boolean);
  return (
    candidates.find((line) => /\.(?:exe|com|cmd|bat)$/i.test(line)) ??
    candidates[0] ??
    null
  );
}

function loginShellPath(discovery: DiscoveryOptions): string | null {
  // Windows has no POSIX login shell to source — the `-ilc` probe below would
  // always fail. Skip it (callers fall back to the registry/system PATH).
  if (process.platform === "win32") return null;
  // Read SHELL through a deliberately opaque accessor so Turbopack's static
  // analysis can't union the value with a string literal like "/bin/zsh"
  // and treat it as a file pattern that matches the whole project tree.
  // The fallback below uses a runtime concatenation for the same reason.
  const env = discovery.env as Record<string, string | undefined>;
  const shell = env["SHELL"] ?? ["/bin", "zsh"].join("/");
  const timeout = remainingDiscoveryTimeout(4000, discovery.deadline, discovery.now);
  if (timeout <= 0) return null;
  try {
    const out = execFileSync(/* turbopackIgnore: true */ shell, ["-ilc", "echo $PATH"], {
      windowsHide: true,
      encoding: "utf-8",
      timeout,
      env: discovery.env,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Parse the `Path` value out of `reg query <key> /v Path` output. For
 * REG_EXPAND_SZ values, expand %VAR% references against `env`
 * (case-insensitively, leaving unknown variables intact — both matching
 * Windows' own expansion); REG_SZ values are returned verbatim.
 * Exported for tests.
 */
export function windowsPathFromRegQuery(
  output: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const match = /^\s*Path\s+(REG_SZ|REG_EXPAND_SZ)\s+(.+)$/im.exec(output);
  const type = match?.[1];
  const value = match?.[2]?.trim();
  if (!type || !value) return null;
  if (type.toUpperCase() !== "REG_EXPAND_SZ") return value;
  const lookup = new Map(
    Object.entries(env).map(([key, val]) => [key.toUpperCase(), val] as const),
  );
  return value.replace(
    /%([^%;=]+)%/g,
    (whole, name: string) => lookup.get(name.toUpperCase()) ?? whole,
  );
}

// Windows equivalent of loginShellPath(): SHELL is unset there, so the
// login-shell probe always fails and refreshCovenSpawnEnv() could never see
// PATH entries added after launch. Installers (including our onboarding
// `npm i -g @opencoven/cli` flow) register new tool dirs by editing the
// machine/user Path in the registry and broadcasting WM_SETTINGCHANGE —
// which already-running processes never receive. Re-reading the registry is
// how a refresh actually picks those up without an app restart.
function windowsRegistryPath(discovery: DiscoveryOptions): string | null {
  const systemRoot = discovery.env.SystemRoot ?? Object.entries(discovery.env).find(
    ([key]) => key.toUpperCase() === "SYSTEMROOT",
  )?.[1];
  const regExecutable = systemRoot
    ? path.join(/* turbopackIgnore: true */ systemRoot, "System32", "reg.exe")
    : null;
  if (!regExecutable || !path.isAbsolute(regExecutable) || !existsSync(regExecutable)) {
    return null;
  }
  // Machine PATH first, then user PATH — the same order Windows itself uses
  // when it builds a process environment.
  const keys = [
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    "HKCU\\Environment",
  ];
  const parts: string[] = [];
  for (const key of keys) {
    const timeout = remainingDiscoveryTimeout(2000, discovery.deadline, discovery.now);
    if (timeout <= 0) break;
    try {
      const out = execFileSync(regExecutable, ["query", key, "/v", "Path"], {
        windowsHide: true,
        encoding: "utf-8",
        timeout,
        env: discovery.env,
      });
      const value = windowsPathFromRegQuery(out, discovery.env);
      if (value) parts.push(value);
    } catch {
      /* key or value missing — keep whatever the other hive provides */
    }
  }
  return parts.length > 0 ? parts.join(path.delimiter) : null;
}

export const COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC =
  "Coven CLI was not found in Cave's launch environment. Install or repair @opencoven/cli, restart Cave, and try again.";

/** UNC and extended-UNC paths cross Cave's owner-local executable boundary. */
export function isWindowsRemoteExecutablePath(candidate: string): boolean {
  const normalized = candidate.replaceAll("/", "\\");
  return /^\\\\[^?.\\]/.test(normalized) || /^\\\\\?\\UNC\\/i.test(normalized);
}

function verifiedAbsoluteBinary(
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathApi = platform === "win32" ? path.win32 : path;
  const crossHostAbsolute = platform !== process.platform && path.isAbsolute(candidate);
  if (!pathApi.isAbsolute(candidate) && !crossHostAbsolute) return null;
  // A Cave-owned local daemon/CLI must not be sourced from a remote UNC share.
  // Besides crossing the local trust boundary, probing one synchronously can
  // defeat the bounded onboarding/status request when the share is offline.
  if (platform === "win32" && isWindowsRemoteExecutablePath(candidate)) {
    return null;
  }
  const absolute = crossHostAbsolute
    ? path.resolve(/* turbopackIgnore: true */ candidate)
    : pathApi.resolve(/* turbopackIgnore: true */ candidate);
  try {
    const canonical = realpathSync(/* turbopackIgnore: true */ absolute);
    if (platform === "win32" && isWindowsRemoteExecutablePath(canonical)) return null;
    const st = statSync(/* turbopackIgnore: true */ canonical);
    return st.isFile() ? canonical : null;
  } catch {
    return null;
  }
}

function environmentValue(
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return env[key];
  const wanted = key.toUpperCase();
  return Object.entries(env).find(([name]) => name.toUpperCase() === wanted)?.[1];
}

/**
 * Resolve Coven from one explicit environment without invoking `where.exe`.
 *
 * Windows' executable search checks the child cwd before PATH. Research and
 * onboarding operate inside user-controlled project/workspace directories,
 * so a bare `where coven` or `spawn("coven")` can select a planted launcher.
 * Only an existing absolute override or a launcher inside an absolute PATH
 * entry is eligible here. Relative entries and remote UNC paths fail closed.
 */
export function covenBinaryFromEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const override = environmentValue(env, "COVEN_BIN", platform)?.trim();
  if (override) {
    const verified = verifiedAbsoluteBinary(override, platform);
    if (verified) return verified;
  }

  const pathApi = platform === "win32" ? path.win32 : path;
  const pathValue = environmentValue(env, "PATH", platform);
  if (!pathValue) return null;
  const names = platform === "win32"
    ? ["coven.cmd", "coven.exe", "coven.com", "coven.bat"]
    : ["coven"];
  const seen = new Set<string>();
  for (const configuredDir of pathValue.split(pathApi.delimiter)) {
    const normalizedDir = configuredDir.trim().replace(/^"|"$/g, "");
    if (!normalizedDir || !pathApi.isAbsolute(normalizedDir)) continue;
    if (platform === "win32" && isWindowsRemoteExecutablePath(normalizedDir)) {
      continue;
    }
    const directory = pathApi.resolve(/* turbopackIgnore: true */ normalizedDir);
    const dedupeKey = platform === "win32" ? directory.toLowerCase() : directory;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    for (const name of names) {
      const verified = verifiedAbsoluteBinary(
        pathApi.join(/* turbopackIgnore: true */ directory, name),
        platform,
      );
      if (verified) return verified;
    }
  }
  return null;
}

/** Resolve an existing absolute Coven launcher. Windows never returns a bare name. */
export function covenBin(): string {
  if (cachedBin) return cachedBin;

  // Explicit override always wins. Useful for local dev when a checkout-built
  // ~/.cargo/bin/coven is newer than the npm-bundled one in ~/.nvm/.../bin.
  const envBin = process.env.COVEN_BIN;
  if (envBin) {
    const verified = verifiedAbsoluteBinary(envBin);
    if (verified) {
      cachedBin = verified;
      return cachedBin;
    }
  }

  const discovery = discoveryOptions();
  const resolved = covenBinaryFromEnvironment(
    {
      ...discovery.env,
      PATH: augmentedSpawnPath(false, discovery),
    },
    process.platform,
  );
  if (resolved) {
    cachedBin = resolved;
    return cachedBin;
  }

  // CreateProcess searches the child cwd before PATH for bare executable
  // names. A Research/project directory must never get to supply `coven.exe`
  // through a bare fallback or relative PATH entry merely because the real CLI
  // is absent from Cave's verified search path.
  if (process.platform === "win32") throw new Error(COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC);
  cachedBin = "coven";
  return cachedBin;
}

function windowsShimTargetFromFile(shimPath: string): string | null {
  const binDir = path.dirname(shimPath);
  try {
    const shim = readFileSync(/* turbopackIgnore: true */ shimPath, "utf-8");
    // npm's cmd-shim generator quotes the package entry point relative to
    // either `%dp0%` (its shim-directory variable) or `%~dp0` (the batch
    // parameter form). Do not infer a package name: an npm `bin` target may
    // be JavaScript, extensionless, or any other file Node can execute.
    for (const line of shim.split(/\r?\n/)) {
      // Standard npm shims first test and assign a local node.exe. Those are
      // setup statements, not the package command to invoke. Only accept
      // quoted `%dp0` paths from a command line; the final one is the entry
      // point for the older `node <script>` shim form as well.
      if (/^\s*(?:@?if\s+exist|@?set(?:local)?\b|@?call\b|@?rem\b|::|:)/i.test(line)) {
        continue;
      }
      const targets = Array.from(line.matchAll(/"([^"]+)"/g))
        .map((match) => match[1]?.trim())
        .map((target) => target && /^%~?dp0%?[\\/]+(.+)$/i.exec(target)?.[1])
        .filter((target): target is string => !!target && !target.includes("%"));
      const relativeTarget = targets.at(-1)?.replace(/[\\/]+/g, path.sep);
      if (!relativeTarget) continue;
      const candidate = path.resolve(/* turbopackIgnore: true */ binDir, relativeTarget);
      if (existsSync(/* turbopackIgnore: true */ candidate)) {
        return candidate;
      }
    }
  } catch {
    /* unreadable or missing shim: leave it unresolved */
  }
  return null;
}

export function windowsShimLaunchCommandForBinary(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): CovenLaunchCommand {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(binary)) {
    return { command: binary, fixedArgs: [] };
  }

  const script = windowsShimTargetFromFile(binary);
  if (!script) {
    return { command: binary, fixedArgs: [], unresolvedWindowsShim: true };
  }
  const verifiedScript = verifiedAbsoluteBinary(script, platform);
  if (!verifiedScript) {
    return { command: binary, fixedArgs: [], unresolvedWindowsShim: true };
  }
  if (/\.(?:exe|com)$/i.test(verifiedScript)) {
    return { command: verifiedScript, fixedArgs: [] };
  }
  return { command: process.execPath, fixedArgs: [verifiedScript] };
}

export function covenLaunchCommandForBinary(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): CovenLaunchCommand {
  return windowsShimLaunchCommandForBinary(binary, platform);
}

export function covenLaunchCommand(): CovenLaunchCommand {
  return covenLaunchCommandForBinary(covenBin());
}

/**
 * Value for COVEN_HARNESS_ADAPTER_DIRS in coven child processes: the user's
 * own value (if any) with COVEN_HOME/adapters appended.
 *
 * Released Coven CLIs (≤0.0.53) only auto-trust manifests in
 * COVEN_HOME/adapters whose id matches a built-in install recipe (hermes
 * today). The manifests Cave scaffolds there for other runtimes (copilot,
 * opencode, …) are silently ignored, so `coven run copilot` failed with
 * "unsupported harness" even though the manifest existed and parsed. The
 * CLI's sanctioned path for other external harnesses is this env var, so
 * every coven spawn points it at the directory Cave writes manifests into.
 * The CLI dedups against recipe-trusted manifests and tolerates a missing
 * directory. Exported for tests.
 */
export function covenAdapterDirsEnvValue(
  existing: string | undefined,
  covenHome?: string,
): string {
  const home = covenHome?.trim() || path.join(/* turbopackIgnore: true */ HOME, ".coven");
  const adaptersDir = path.join(/* turbopackIgnore: true */ home, "adapters");
  const dirs = (existing ?? "").split(path.delimiter).filter(Boolean);
  if (dirs.includes(adaptersDir)) return dirs.join(path.delimiter);
  return [...dirs, adaptersDir].join(path.delimiter);
}

/**
 * Augmented spawn env with PATH containing the user's interactive-shell PATH
 * plus the candidate dirs (in priority order), so subprocesses launched from
 * a Finder-spawned cave can still resolve nested tooling (codex, claude,
 * git, gh, …).
 */
function augmentedSpawnPath(
  preferLaunchPath: boolean,
  discovery: DiscoveryOptions,
): string {
  const fromSystem = process.platform === "win32"
    ? windowsRegistryPath(discovery)
    : loginShellPath(discovery);
  // Windows retains the casing it inherited for environment keys (normally
  // `Path`). After copying the environment, `env.PATH` therefore cannot be
  // relied on even though `process.env.PATH` is case-insensitive. Read it
  // case-insensitively so a desktop launch PATH remains first for Queue tools.
  const launchPathValue = discovery.env.PATH ?? Object.entries(discovery.env).find(
    ([key]) => key.toUpperCase() === "PATH",
  )?.[1];
  const launchPath = launchPathValue ? launchPathValue.split(path.delimiter) : [];
  const systemPath = fromSystem ? fromSystem.split(path.delimiter) : [];
  const candidates = candidateDirs(discovery);
  // `coven` intentionally prefers its managed install locations over a stale
  // shell binary. General Queue tools must do the opposite: a desktop launch
  // should honor the user's PATH before falling back to Cave's helpful extras.
  const parts = preferLaunchPath
    ? [...launchPath, ...systemPath, ...candidates]
    : [...candidates, ...systemPath, ...launchPath];
  const seen = new Set<string>();
  return parts.filter((part) => !!part && !seen.has(part) && (seen.add(part), true)).join(path.delimiter);
}

export const COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV =
  "COVEN_WINDOWS_HIDE_NATIVE_WINDOW";

/**
 * Mark only Cave-owned Coven-wrapper launches as GUI children on Windows.
 * The npm wrapper keeps ordinary terminal invocations interactive unless this
 * exact opt-in is present; user-selected project tools never inherit it.
 */
export function withCovenWrapperWindowPolicy(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  appOwnedCovenLaunch = true,
): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (
      (platform === "win32" ? key.toUpperCase() : key)
      === COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV
    ) {
      delete next[key];
    }
  }
  if (appOwnedCovenLaunch && platform === "win32") {
    next[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV] = "1";
  }
  return next;
}

function spawnEnv(
  pathValue: string,
  includeManagedNode = true,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: pathValue };
  if (includeManagedNode) {
    const managed = managedNodeSpawnEnv(env);
    if (managed) Object.assign(env, managed);
  }
  env.COVEN_HARNESS_ADAPTER_DIRS = covenAdapterDirsEnvValue(
    process.env.COVEN_HARNESS_ADAPTER_DIRS,
    process.env.COVEN_HOME,
  );
  // npm emits `npm warn Unknown env config <key>` to stderr for any config
  // key it no longer recognizes (e.g. a stale `_jsr-registry`,
  // `minimum-release-age`, or `manage-package-manager-versions` left in the
  // user's ~/.npmrc or environment). We surface interleaved stdout+stderr in
  // the Tools panel, so those benign warnings pollute the installer output.
  // Quiet npm to error-level only — real failures still come through, the
  // config-parse noise does not. Non-npm children ignore this variable.
  if (env.NPM_CONFIG_LOGLEVEL === undefined && env.npm_config_loglevel === undefined) {
    env.NPM_CONFIG_LOGLEVEL = "error";
  }
  // This is the shared baseline for Coven itself, harnesses, onboarding
  // probes, npm, SSH, and user-selected tools. A wrapper-only control signal
  // must never ride that generic environment into an unrelated child.
  return withCovenWrapperWindowPolicy(
    scrubSidecarInternalEnv(env),
    process.platform,
    false,
  );
}

export function covenSpawnEnv(options: CovenSpawnEnvOptions = {}): NodeJS.ProcessEnv {
  if (cachedPath !== null) return spawnEnv(cachedPath);
  const discovery = discoveryOptions(options);
  const pathValue = augmentedSpawnPath(false, discovery);
  if (discovery.deadline === undefined || discovery.now() < discovery.deadline) {
    cachedPath = pathValue;
  }
  return spawnEnv(pathValue);
}

/**
 * Opt one exact Cave-owned Coven CLI invocation into the npm wrapper's native
 * no-window policy. Call this only at a call site whose resolved command is
 * `coven`; generic harness/tool environments deliberately stay scrubbed.
 */
export function covenWrapperSpawnEnv(
  env: NodeJS.ProcessEnv = covenSpawnEnv(),
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  return withCovenWrapperWindowPolicy(env, platform, true);
}

/**
 * Augmented, scrubbed environment for user-selected project tooling (Git,
 * Beads, GitHub CLI). Preserve the actual launch/login PATH before Cave's
 * fallback directories so Finder/Spotlight launches behave like the user's
 * shell and a deliberately selected tool is never shadowed by Cave's own
 * binary-discovery priority.
 */
export function caveToolSpawnEnv(): NodeJS.ProcessEnv {
  cachedToolPath ??= augmentedSpawnPath(true, discoveryOptions());
  return spawnEnv(cachedToolPath, false);
}

export function refreshCovenSpawnEnv(
  options: CovenSpawnEnvOptions = {},
): NodeJS.ProcessEnv {
  cachedPath = null;
  cachedToolPath = null;
  return covenSpawnEnv(options);
}

/**
 * Drop both executable and PATH discovery caches after a global CLI install.
 * A long-running desktop Cave process otherwise keeps launching the binary it
 * resolved before npm rewrote its shim or registered a new global bin dir.
 */
export function refreshCovenBin(): string {
  cachedBin = null;
  cachedPath = null;
  cachedToolPath = null;
  return covenBin();
}
