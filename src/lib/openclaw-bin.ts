// openclaw-bin: resolve the OpenClaw CLI and spawn env for direct agent chat.
//
// Windows npm exposes global CLIs as .cmd shims under %APPDATA%\npm. Node's
// spawn cannot launch those shims like normal executables unless shell mode is
// enabled, so OpenClaw gets the same explicit resolver contract as coven.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { covenSpawnEnv } from "./coven-bin";

let cachedBin: string | null = null;

const FORBIDDEN_SPAWN_ENV_KEYS = new Set(["GITHUB_PAT"]);
const FORBIDDEN_SPAWN_ENV_RE =
  /(?:^|_)(?:TOKEN|KEY|SECRET|PASSWORD|PASS|PAT|CREDENTIALS?|COOKIE|SESSION)(?:_|$)/i;

function allowedOpenClawEnvKeys(): Set<string> {
  return new Set(
    (process.env.OPENCLAW_ALLOW_ENV_KEYS ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function windowsNpmBinDirs(): string[] {
  if (process.platform !== "win32") return [];
  return [
    process.env.APPDATA ? path.join(/* turbopackIgnore: true */ process.env.APPDATA, "npm") : null,
    process.env.npm_config_prefix ?? null,
  ].filter((dir): dir is string => !!dir && existsSync(/* turbopackIgnore: true */ dir));
}

function candidateDirs(): string[] {
  const env = covenSpawnEnv();
  return dedupe([
    ...windowsNpmBinDirs(),
    ...(env.PATH ? env.PATH.split(path.delimiter) : []),
  ]).filter((dir) => existsSync(/* turbopackIgnore: true */ dir));
}

function candidateBinNames(): string[] {
  return process.platform === "win32" ? ["openclaw.cmd", "openclaw.exe", "openclaw"] : ["openclaw"];
}

export function openClawBin(): string {
  if (cachedBin) return cachedBin;

  const envBin = process.env.OPENCLAW_BIN;
  if (envBin) {
    try {
      const st = statSync(/* turbopackIgnore: true */ envBin);
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
      const candidate = path.join(/* turbopackIgnore: true */ dir, name);
      try {
        const st = statSync(/* turbopackIgnore: true */ candidate);
        if (st.isFile() || st.isSymbolicLink()) {
          cachedBin = candidate;
          return cachedBin;
        }
      } catch {
        /* not here; keep looking */
      }
    }
  }

  cachedBin = "openclaw";
  return cachedBin;
}

export function openClawNeedsShell(bin = openClawBin()): boolean {
  return process.platform === "win32" && bin.toLowerCase().endsWith(".cmd");
}

export function openClawSupportsUntrustedArgs(bin = openClawBin()): boolean {
  return !openClawNeedsShell(bin);
}

const WINDOWS_SHELL_META_RE = /[\s"&|<>()^%!]/;

function quoteWindowsShellArg(arg: string): string {
  if (arg.length === 0) return "\"\"";
  if (!WINDOWS_SHELL_META_RE.test(arg)) return arg;

  // Node joins args into one cmd.exe command line when shell:true is set.
  // Quote each logical argv entry so multi-word --message payloads stay intact.
  let escaped = "";
  let backslashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === "\"") {
      escaped += "\\".repeat(backslashes * 2 + 1);
      escaped += "\"";
      backslashes = 0;
      continue;
    }
    escaped += "\\".repeat(backslashes);
    backslashes = 0;
    escaped += char;
  }
  escaped += "\\".repeat(backslashes * 2);
  return `"${escaped}"`;
}

export function openClawSpawnArgs(argv: string[], bin = openClawBin()): string[] {
  return openClawNeedsShell(bin) ? argv.map(quoteWindowsShellArg) : argv;
}

export function openClawSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...covenSpawnEnv() };
  const allowed = allowedOpenClawEnvKeys();
  for (const key of Object.keys(env)) {
    if (
      (FORBIDDEN_SPAWN_ENV_KEYS.has(key) || FORBIDDEN_SPAWN_ENV_RE.test(key)) &&
      !allowed.has(key)
    ) {
      delete env[key];
    }
  }
  return env;
}
