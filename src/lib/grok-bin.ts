// grok-bin: resolve the Grok Build launcher for direct native chat.
//
// Grok Build's official installer provides a native executable in
// ~/.grok/bin, while npm installs expose a Windows .cmd shim.  The latter
// cannot be spawned directly by Node, so keep the resolution and shim
// handling in one server-only helper instead of assuming grok.exe exists.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  covenLaunchCommandForBinary,
  covenSpawnEnv,
  pickWindowsLauncher,
  type CovenLaunchCommand,
} from "./coven-bin";

let cachedBin: string | null = null;

function candidateDirs(): string[] {
  const env = covenSpawnEnv();
  return (env.PATH ?? "")
    .split(path.delimiter)
    .filter((directory, index, dirs) =>
      !!directory && dirs.indexOf(directory) === index && existsSync(directory),
    );
}

/**
 * A WSL process can invoke a native Windows `.exe` directly when the Windows
 * PATH has been imported.  Unlike Windows, Linux's exec lookup does not use
 * PATHEXT, so include the extension explicitly instead of requiring users to
 * set GROK_BIN after installing Grok Build on the Windows side.
 */
export function grokCandidateBinNames(
  platform: NodeJS.Platform = process.platform,
  release: string = os.release(),
): string[] {
  // Prefer the native installer when both it and an npm shim are present in
  // the same directory. PATH directory order remains the user-visible
  // precedence across installation methods.
  if (platform === "win32") {
    return ["grok.exe", "grok.cmd", "grok.bat", "grok"];
  }
  return /(?:microsoft|wsl)/i.test(release)
    ? ["grok", "grok.exe"]
    : ["grok"];
}

/** Resolve an explicit override, native installer binary, or npm shim. */
export function grokBin(): string {
  if (cachedBin) return cachedBin;

  const override = process.env.GROK_BIN;
  if (override) {
    try {
      const stat = statSync(override);
      if (stat.isFile() || stat.isSymbolicLink()) {
        cachedBin = override;
        return cachedBin;
      }
    } catch {
      /* use normal discovery */
    }
  }

  for (const directory of candidateDirs()) {
    for (const name of grokCandidateBinNames()) {
      const candidate = path.join(directory, name);
      try {
        const stat = statSync(candidate);
        if (stat.isFile() || stat.isSymbolicLink()) {
          cachedBin = candidate;
          return cachedBin;
        }
      } catch {
        /* try the next launcher */
      }
    }
  }

  // `where` preserves Windows' PATHEXT/PATH lookup, including Node's global
  // npm shim directory when it was not present at Cave startup.
  if (process.platform === "win32") {
    try {
      const output = execFileSync("where", ["grok"], {
        encoding: "utf8",
        timeout: 1500,
        env: covenSpawnEnv(),
      });
      const found = pickWindowsLauncher(output.split(/\r?\n/));
      if (found) {
        cachedBin = found;
        return cachedBin;
      }
    } catch {
      /* fall through to Node's normal PATH lookup */
    }
  }

  return "grok";
}

export function grokLaunchCommandForBinary(binary: string): CovenLaunchCommand {
  return covenLaunchCommandForBinary(binary);
}

/** A spawn-safe command for the native executable or an npm Windows shim. */
export function grokLaunchCommand(): CovenLaunchCommand {
  return grokLaunchCommandForBinary(grokBin());
}
