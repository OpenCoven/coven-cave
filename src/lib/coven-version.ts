import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { covenBin, covenSpawnEnv } from "./coven-bin.ts";

const execFileAsync = promisify(execFile);

export function firstSemver(text: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(text);
  return match?.[1] ?? null;
}

function isPlaceholderVersion(version: string | undefined): boolean {
  return !version || version === "0.0.0";
}

export function displayCovenVersion({
  daemonVersion,
  installedVersion,
}: {
  daemonVersion?: string;
  installedVersion: string | null;
}): string | undefined {
  if (!isPlaceholderVersion(daemonVersion)) return daemonVersion;
  return installedVersion ?? undefined;
}

export async function installedCovenVersion(): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(covenBin(), ["--version"], {
      env: covenSpawnEnv(),
      timeout: 2500,
    });
    return firstSemver(`${stdout}\n${stderr}`);
  } catch {
    return null;
  }
}
