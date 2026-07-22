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
  refreshCovenSpawnEnv,
  type CovenLaunchCommand,
} from "./coven-bin";

let cachedBin: string | null = null;

function candidateDirs(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? "")
    .split(path.delimiter)
    .filter((directory, index, dirs) =>
      !!directory && dirs.indexOf(directory) === index && existsSync(directory),
    );
}

function grokBinFromPath(env: NodeJS.ProcessEnv): string | null {
  for (const directory of candidateDirs(env)) {
    for (const name of grokCandidateBinNames()) {
      // This is a runtime PATH probe, not a bundled file dependency. Keep
      // Turbopack's output-file tracer from treating the dynamic directory as
      // a project glob (which would package the whole checkout).
      const candidate = path.join(/* turbopackIgnore: true */ directory, name);
      try {
        const stat = statSync(candidate);
        if (stat.isFile() || stat.isSymbolicLink()) return candidate;
      } catch {
        /* try the next launcher */
      }
    }
  }
  return null;
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
    // A Windows global npm install only guarantees a .cmd shim (rather than
    // grok.exe). WSL can read its JS entry point, so recognize that launcher
    // too instead of requiring a second Linux-side Grok installation.
    ? ["grok", "grok.exe", "grok.cmd", "grok.bat"]
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

  const fromPath = grokBinFromPath(covenSpawnEnv()) ?? grokBinFromPath(refreshCovenSpawnEnv());
  if (fromPath) {
    cachedBin = fromPath;
    return cachedBin;
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
  // A WSL Cave process can discover a Windows global npm shim through the
  // imported Windows PATH. Treat that shim like its native-Windows counterpart
  // so we execute its JavaScript target with argv (never through cmd.exe,
  // which would re-parse untrusted chat prompts as shell syntax).
  const shimPlatform = /\.(cmd|bat)$/i.test(binary) ? "win32" : process.platform;
  return covenLaunchCommandForBinary(binary, shimPlatform);
}

/** A spawn-safe command for the native executable or an npm Windows shim. */
export function grokLaunchCommand(): CovenLaunchCommand {
  return grokLaunchCommandForBinary(grokBin());
}
