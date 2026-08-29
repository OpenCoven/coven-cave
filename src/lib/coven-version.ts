import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { covenLaunchCommand, covenWrapperSpawnEnv } from "./coven-bin.ts";
import { exactSemver } from "./exact-semver.ts";

const execFileAsync = promisify(execFile);

export { exactSemver };

export function firstSemver(text: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(text);
  return match?.[1] ?? null;
}

/** Prefer the CLI's stdout when stderr contains an unrelated version string. */
export function covenVersionFromOutput(stdout: string, stderr: string): string | null {
  return firstSemver(stdout) ?? firstSemver(stderr);
}

export function displayCovenVersion({
  daemonVersion,
  installedVersion,
}: {
  daemonVersion?: string;
  installedVersion: string | null;
}): string | undefined {
  // On a local desktop, the daemon can be an older process left running
  // across a Coven CLI update. Settings describes the installed CLI the user
  // will launch next, so prefer that verified version whenever discovery found
  // one. Hub responses have no installedVersion and continue to display the
  // version reported by the remote daemon.
  const installed = exactSemver(installedVersion);
  if (installed && installed !== "0.0.0") return installed;

  const daemon = exactSemver(daemonVersion);
  if (daemon && daemon !== "0.0.0") return daemon;
  return undefined;
}

export async function installedCovenVersion(): Promise<string | null> {
  try {
    const { command, fixedArgs } = covenLaunchCommand();
    const { stdout, stderr } = await execFileAsync(command, [...fixedArgs, "--version"], {
      windowsHide: true,
      env: covenWrapperSpawnEnv(),
      timeout: 2500,
    });
    return covenVersionFromOutput(stdout, stderr);
  } catch {
    return null;
  }
}
