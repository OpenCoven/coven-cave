// Spawn-safe Codex launcher resolution.
//
// Windows npm installs expose codex.cmd. Node cannot execute batch shims
// directly, and using cmd.exe would re-parse project paths or resume ids as
// shell syntax. Resolve the shim's JavaScript target and invoke Node directly.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  covenLaunchCommandForBinary,
  type CovenLaunchCommand,
} from "./coven-bin.ts";

function candidateDirs(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.PATH ?? "")
    .split(path.delimiter)
    .map((directory) => directory.trim().replace(/^"|"$/g, ""));
  if (process.platform === "win32" && env.APPDATA) {
    configured.push(path.join(env.APPDATA, "npm"));
  }
  return configured.filter((directory, index) =>
    !!directory && configured.indexOf(directory) === index && existsSync(directory));
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
    try {
      const stat = statSync(override);
      if (stat.isFile() || stat.isSymbolicLink()) return override;
    } catch {
      // An invalid override must not make us run an arbitrary shell command.
    }
  }
  for (const directory of candidateDirs(env)) {
    for (const name of codexCandidateBinNames(platform)) {
      const candidate = path.join(/* turbopackIgnore: true */ directory, name);
      try {
        const stat = statSync(candidate);
        if (stat.isFile() || stat.isSymbolicLink()) return candidate;
      } catch {
        // Continue searching the launcher's effective PATH.
      }
    }
  }
  return "codex";
}

/** A non-shell direct-launch command for Codex on every supported platform. */
export function codexLaunchCommand(
  binary: string = codexBin(),
  platform: NodeJS.Platform = process.platform,
): CovenLaunchCommand {
  return covenLaunchCommandForBinary(binary, platform);
}
