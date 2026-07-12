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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let cachedBin: string | null = null;
let cachedPath: string | null = null;

export type CovenLaunchCommand = {
  command: string;
  fixedArgs: string[];
};

const FORBIDDEN_SPAWN_ENV_KEYS = ["GITHUB_PAT", "GITHUB_PERSONAL_ACCESS_TOKEN"] as const;

const HOME = os.homedir();

function nodeNvmBinDirs(): string[] {
  const nvmRoot = path.join(HOME, ".nvm", "versions", "node");
  if (!existsSync(nvmRoot)) return [];
  try {
    return readdirSync(nvmRoot)
      .map((v) => path.join(nvmRoot, v, "bin"))
      .filter((d) => existsSync(d))
      .sort()
      .reverse(); // newest version first by lexicographic sort
  } catch {
    return [];
  }
}

function fnmBinDirs(): string[] {
  const fnmRoot = path.join(HOME, ".fnm", "node-versions");
  if (!existsSync(fnmRoot)) return [];
  try {
    return readdirSync(fnmRoot)
      .map((v) => path.join(fnmRoot, v, "installation", "bin"))
      .filter((d) => existsSync(d))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function windowsNpmBinDirs(): string[] {
  if (process.platform === "win32") {
    const dirs = [
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
      process.env.npm_config_prefix ?? null,
    ].filter((d): d is string => !!d && existsSync(d));
    return Array.from(new Set(dirs));
  }
  return [];
}

function candidateDirs(): string[] {
  return [
    ...nodeNvmBinDirs(),
    ...fnmBinDirs(),
    ...windowsNpmBinDirs(),
    path.join(HOME, "Library", "pnpm"),
    path.join(HOME, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(HOME, ".local", "bin"),
    // ~/.cargo/bin last: often holds a stale `cargo install` of coven that's
    // missing flags. Prefer the npm-published binary when both exist.
    path.join(HOME, ".cargo", "bin"),
  ].filter((d) => existsSync(d));
}

function candidateBinNames(): string[] {
  return process.platform === "win32" ? ["coven.cmd", "coven.exe", "coven"] : ["coven"];
}

/**
 * Pick the spawnable launcher from `where` output. npm's global installs
 * write three launchers per package (an extensionless POSIX script, a .cmd
 * shim, and a .ps1), and `where` lists the extensionless one first — but a
 * bare Windows spawn() can only execute .exe/.com, and a .cmd needs
 * covenLaunchCommandForBinary() to convert it into a direct `node <script>`
 * spawn. So prefer .exe/.com, then .cmd/.bat, and only then the first line
 * (callers that merely display the path still get something).
 */
export function pickWindowsLauncher(lines: string[]): string | null {
  const candidates = lines.map((line) => line.trim()).filter(Boolean);
  const byExt = (...exts: string[]) =>
    candidates.find((line) => exts.some((ext) => line.toLowerCase().endsWith(ext)));
  return byExt(".exe", ".com") ?? byExt(".cmd", ".bat") ?? candidates[0] ?? null;
}

function loginShellPath(): string | null {
  // Windows has no POSIX login shell to source — the `-ilc` probe below would
  // always fail. Skip it (callers fall back to the registry/system PATH).
  if (process.platform === "win32") return null;
  // Read SHELL through a deliberately opaque accessor so Turbopack's static
  // analysis can't union the value with a string literal like "/bin/zsh"
  // and treat it as a file pattern that matches the whole project tree.
  // The fallback below uses a runtime concatenation for the same reason.
  const env = process.env as Record<string, string | undefined>;
  const shell = env["SHELL"] ?? ["/bin", "zsh"].join("/");
  try {
    const out = execFileSync(shell, ["-ilc", "echo $PATH"], {
      encoding: "utf-8",
      timeout: 4000,
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
function windowsRegistryPath(): string | null {
  // Machine PATH first, then user PATH — the same order Windows itself uses
  // when it builds a process environment.
  const keys = [
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    "HKCU\\Environment",
  ];
  const parts: string[] = [];
  for (const key of keys) {
    try {
      const out = execFileSync("reg", ["query", key, "/v", "Path"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      const value = windowsPathFromRegQuery(out);
      if (value) parts.push(value);
    } catch {
      /* key or value missing — keep whatever the other hive provides */
    }
  }
  return parts.length > 0 ? parts.join(path.delimiter) : null;
}

/**
 * Resolve the absolute path to the `coven` binary. If nothing is found,
 * returns the literal string "coven" so callers can still spawn — the OS
 * will resolve via PATH and surface a "not found" error to the user.
 */
export function covenBin(): string {
  if (cachedBin) return cachedBin;

  // Explicit override always wins. Useful for local dev when a checkout-built
  // ~/.cargo/bin/coven is newer than the npm-bundled one in ~/.nvm/.../bin.
  const envBin = process.env.COVEN_BIN;
  if (envBin) {
    try {
      const st = statSync(envBin);
      if (st.isFile() || st.isSymbolicLink()) {
        cachedBin = envBin;
        return cachedBin;
      }
    } catch {
      /* fall through to discovery */
    }
  }

  for (const dir of candidateDirs()) {
    for (const name of candidateBinNames()) {
      const candidate = path.join(dir, name);
      try {
        const st = statSync(candidate);
        if (st.isFile() || st.isSymbolicLink()) {
          cachedBin = candidate;
          return cachedBin;
        }
      } catch {
        /* not here; keep looking */
      }
    }
  }

  // Nothing in the well-known dirs. On Windows, resolve through PATH with
  // `where` before falling back to the literal name: npm installs the CLI
  // as coven.cmd (plus an unspawnable extensionless POSIX script), and a
  // bare spawn("coven") only resolves .exe/.com — so the literal fallback
  // ENOENTs even when the CLI is plainly on PATH (scoop/winget node,
  // cave-observed on Windows 11).
  if (process.platform === "win32") {
    try {
      const out = execFileSync("where", ["coven"], {
        encoding: "utf-8",
        timeout: 1500,
        env: covenSpawnEnv(),
      });
      const picked = pickWindowsLauncher(out.split(/\r?\n/));
      if (picked) {
        cachedBin = picked;
        return cachedBin;
      }
    } catch {
      /* not on PATH either — fall through to the literal fallback */
    }
  }

  cachedBin = "coven";
  return cachedBin;
}

function windowsShimTargetFromFile(shimPath: string): string | null {
  const binDir = path.dirname(shimPath);
  try {
    const shim = readFileSync(shimPath, "utf-8");
    const quotedTargets = shim.matchAll(/"(%(?:~?dp0)%?)[\\/]*([^"]+\.[cm]?js)"/gi);
    for (const match of quotedTargets) {
      const relativeTarget = match[2]?.replace(/[\\/]+/g, path.sep);
      if (!relativeTarget) continue;
      const candidate = path.resolve(binDir, relativeTarget);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* fall through to the conventional npm global layout */
  }

  const conventionalTarget = path.join(
    binDir,
    "node_modules",
    "@opencoven",
    "cli",
    "bin",
    "coven.js",
  );
  return existsSync(conventionalTarget) ? conventionalTarget : null;
}

export function covenLaunchCommandForBinary(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): CovenLaunchCommand {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(binary)) {
    return { command: binary, fixedArgs: [] };
  }

  const script = windowsShimTargetFromFile(binary);
  if (!script) return { command: binary, fixedArgs: [] };
  return { command: process.execPath, fixedArgs: [script] };
}

export function covenLaunchCommand(): CovenLaunchCommand {
  return covenLaunchCommandForBinary(covenBin());
}

/**
 * Value for COVEN_HARNESS_ADAPTER_DIRS in coven child processes: the user's
 * own value (if any) with COVEN_HOME/adapters appended.
 *
 * Released coven CLIs (≤0.0.53) only auto-trust manifests in
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
  const home = covenHome?.trim() || path.join(HOME, ".coven");
  const adaptersDir = path.join(home, "adapters");
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
export function covenSpawnEnv(): NodeJS.ProcessEnv {
  if (cachedPath === null) {
    const fromSystem =
      process.platform === "win32" ? windowsRegistryPath() : loginShellPath();
    const prependedDirs = candidateDirs();
    const parts = [
      ...prependedDirs,
      ...(fromSystem ? fromSystem.split(path.delimiter) : []),
      ...(process.env.PATH ? process.env.PATH.split(path.delimiter) : []),
    ];
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const p of parts) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      dedup.push(p);
    }
    cachedPath = dedup.join(path.delimiter);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: cachedPath };
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
  for (const key of FORBIDDEN_SPAWN_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

export function refreshCovenSpawnEnv(): NodeJS.ProcessEnv {
  cachedPath = null;
  return covenSpawnEnv();
}
