// openclaw-bin: resolve the OpenClaw CLI and spawn env for direct agent chat.
//
// Windows npm exposes global CLIs as .cmd shims under %APPDATA%\npm. Node's
// spawn cannot launch those shims like normal executables unless shell mode is
// enabled, so OpenClaw gets the same explicit resolver contract as coven.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { covenSpawnEnv } from "./coven-bin";

let cachedBin: string | null = null;

const FORBIDDEN_SPAWN_ENV_KEYS = ["GITHUB_PAT"] as const;

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
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
    process.env.npm_config_prefix ?? null,
  ].filter((dir): dir is string => !!dir && existsSync(dir));
}

function candidateDirs(): string[] {
  const env = covenSpawnEnv();
  return dedupe([
    ...windowsNpmBinDirs(),
    ...(env.PATH ? env.PATH.split(path.delimiter) : []),
  ]).filter((dir) => existsSync(dir));
}

function candidateBinNames(): string[] {
  return process.platform === "win32" ? ["openclaw.cmd", "openclaw.exe", "openclaw"] : ["openclaw"];
}

export function openClawBin(): string {
  if (cachedBin) return cachedBin;

  const envBin = process.env.OPENCLAW_BIN;
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

  cachedBin = "openclaw";
  return cachedBin;
}

export function openClawNeedsShell(): boolean {
  return process.platform === "win32";
}

export function openClawSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...covenSpawnEnv() };
  for (const key of FORBIDDEN_SPAWN_ENV_KEYS) {
    delete env[key];
  }
  return env;
}
