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
// All cave spawn sites of `coven` should use `covenBin()` for argv[0] and
// `covenSpawnEnv()` for the env option.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let cachedBin: string | null = null;
let cachedPath: string | null = null;
let cachedInvocation: { command: string; prefixArgs: string[] } | null = null;

const FORBIDDEN_SPAWN_ENV_KEYS = ["GITHUB_PAT"] as const;

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

function loginShellPath(): string | null {
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

  cachedBin = "coven";
  return cachedBin;
}

// Parse an npm/pnpm `.cmd` shim for the Node script it execs, e.g. the line
//   "%_prog%" "%dp0%\node_modules\@opencoven\cli\bin\coven.js" %*
// Falls back to the conventional npm-global layout when the shim format is
// unrecognized. Returns an absolute path to the `.js` entry, or null.
function resolveWindowsShimTarget(cmdPath: string): string | null {
  const binDir = path.dirname(cmdPath);
  try {
    const text = readFileSync(cmdPath, "utf-8");
    const match = text.match(/%dp0%[\\/]+(\S+?\.[cm]?js)"/i);
    if (match) {
      const resolved = path.join(binDir, match[1].replace(/[\\/]+/g, path.sep));
      if (existsSync(resolved)) return resolved;
    }
  } catch {
    /* unreadable shim — fall through to the conventional layout */
  }
  const fallback = path.join(
    binDir,
    "node_modules",
    "@opencoven",
    "cli",
    "bin",
    "coven.js",
  );
  return existsSync(fallback) ? fallback : null;
}

/**
 * Resolve how to launch `coven` as a child process: the command plus a fixed
 * argv prefix that callers prepend to their own args.
 *
 * Why this exists: on Windows, npm/pnpm install `coven` as a `.cmd` (batch)
 * shim. Since the CVE-2024-27980 hardening (Node >=18.20 / 20.12 / 21.7),
 * `child_process.spawn()`/`execFile()` THROW `EINVAL` when handed a `.cmd` or
 * `.bat` unless `shell: true` is set — and shell mode is unsafe for argv that
 * carries user text (chat prompt content). So resolve the shim to the Node
 * script it wraps and run `node <script>` directly, which safely accepts
 * arbitrary args. On macOS/Linux `coven` is a real executable, so this is the
 * identity ({ command: covenBin(), prefixArgs: [] }).
 *
 * Usage: const { command, prefixArgs } = covenInvocation();
 *        spawn(command, [...prefixArgs, ...yourArgs], opts);
 */
export function covenInvocation(): { command: string; prefixArgs: string[] } {
  if (cachedInvocation) return cachedInvocation;
  const bin = covenBin();
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    const script = resolveWindowsShimTarget(bin);
    if (script) {
      cachedInvocation = { command: process.execPath, prefixArgs: [script] };
      return cachedInvocation;
    }
  }
  cachedInvocation = { command: bin, prefixArgs: [] };
  return cachedInvocation;
}

/**
 * Augmented spawn env with PATH containing the user's interactive-shell PATH
 * plus the candidate dirs (in priority order), so subprocesses launched from
 * a Finder-spawned cave can still resolve nested tooling (codex, claude,
 * git, gh, …).
 */
export function covenSpawnEnv(): NodeJS.ProcessEnv {
  if (cachedPath === null) {
    const fromShell = loginShellPath();
    const prependedDirs = candidateDirs();
    const parts = [
      ...prependedDirs,
      ...(fromShell ? fromShell.split(path.delimiter) : []),
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
  for (const key of FORBIDDEN_SPAWN_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

export function refreshCovenSpawnEnv(): NodeJS.ProcessEnv {
  cachedPath = null;
  return covenSpawnEnv();
}
