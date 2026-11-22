// Spawn-safe Codex launcher resolution.
//
// Windows npm installs expose codex.cmd. Node cannot execute batch shims
// directly, and using cmd.exe would re-parse project paths or resume ids as
// shell syntax. Resolve the shim's JavaScript target and invoke Node directly.

import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  covenLaunchCommandForBinary,
  isWindowsRemoteExecutablePath,
  type CovenLaunchCommand,
} from "./coven-bin.ts";

function candidateDirs(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const configured = (env.PATH ?? "")
    .split(platform === "win32" ? ";" : path.delimiter)
    .map((directory) => directory.trim().replace(/^"|"$/g, ""));
  if (platform === "win32" && env.APPDATA) {
    configured.push(path.join(/* turbopackIgnore: true */ env.APPDATA, "npm"));
  }
  return configured
    .filter((directory, index) => !!directory && configured.indexOf(directory) === index)
    .filter((directory) => path.isAbsolute(directory))
    .filter((directory) => platform !== "win32" || !isWindowsRemoteExecutablePath(directory))
    .map((directory) => path.resolve(/* turbopackIgnore: true */ directory))
    .filter((directory) => existsSync(/* turbopackIgnore: true */ directory));
}

export const CODEX_WINDOWS_NOT_FOUND_DIAGNOSTIC =
  "Codex CLI was not found in Cave's launch environment. Install or repair the official @openai/codex package, restart Cave, and try again.";

function verifiedAbsoluteFile(
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!path.isAbsolute(candidate)) return null;
  if (platform === "win32" && isWindowsRemoteExecutablePath(candidate)) return null;
  const absolute = path.resolve(/* turbopackIgnore: true */ candidate);
  try {
    const canonical = realpathSync(/* turbopackIgnore: true */ absolute);
    if (platform === "win32" && isWindowsRemoteExecutablePath(canonical)) return null;
    const stat = statSync(/* turbopackIgnore: true */ canonical);
    return stat.isFile() ? canonical : null;
  } catch {
    return null;
  }
}

export function codexCandidateBinNames(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "win32"
    ? ["codex.exe", "codex.cmd", "codex.bat", "codex"]
    : ["codex"];
}

/** Resolve a native Codex executable or npm's Windows command shim. */
export function codexBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.CODEX_BIN;
  if (override) {
    const verified = verifiedAbsoluteFile(override, platform);
    if (verified) return verified;
  }
  for (const directory of candidateDirs(env, platform)) {
    for (const name of codexCandidateBinNames(platform)) {
      const candidate = path.join(/* turbopackIgnore: true */ directory, name);
      const verified = verifiedAbsoluteFile(candidate, platform);
      if (verified) return verified;
    }
  }
  // POSIX PATH lookup does not implicitly search the child's cwd unless the
  // user explicitly put a relative entry in PATH. Windows CreateProcess does:
  // a bare fallback or relative PATH entry would let a Research workspace
  // plant `codex.exe` and have Cave execute it when the real CLI is missing.
  if (platform === "win32") throw new Error(CODEX_WINDOWS_NOT_FOUND_DIAGNOSTIC);
  return "codex";
}

/** A non-shell direct-launch command for Codex on every supported platform. */
export function codexLaunchCommand(
  binary: string = codexBin(),
  platform: NodeJS.Platform = process.platform,
): CovenLaunchCommand {
  return covenLaunchCommandForBinary(binary, platform);
}
