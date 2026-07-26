import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { covenLaunchCommand, covenSpawnEnv } from "./coven-bin.ts";
import { exactSemver } from "./exact-semver.ts";

const execFileAsync = promisify(execFile);

export { exactSemver };

export function firstSemver(text: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(text);
  return match?.[1] ?? null;
}

export function displayCovenVersion({
  daemonVersion,
  installedVersion,
}: {
  daemonVersion?: string;
  installedVersion: string | null;
}): string | undefined {
  const daemon = exactSemver(daemonVersion);
  if (daemon && daemon !== "0.0.0") return daemon;
  return exactSemver(installedVersion) ?? undefined;
}

export async function installedCovenVersion(): Promise<string | null> {
  try {
    const { command, fixedArgs } = covenLaunchCommand();
    const { stdout, stderr } = await execFileAsync(command, [...fixedArgs, "--version"], {
      env: covenSpawnEnv(),
      timeout: 2500,
    });
    return firstSemver(`${stdout}\n${stderr}`);
  } catch {
    return null;
  }
}
