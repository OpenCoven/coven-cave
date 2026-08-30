import { homedir } from "node:os";
import path from "node:path";
import { isRemoteWindowsPath } from "./windows-local-path.ts";

export type CovenHomeEnvironment = Record<string, string | undefined>;
export type CovenHomeRemoteRefusal = (configuredHome: string) => void;

/**
 * Resolve the user's Coven home, refusing an explicit Windows path that does
 * not prove it stays on this machine. An explicit remote override falls back
 * to the local home rather than becoming a remote file read or write.
 *
 * The optional callback lets daemon discovery retain its existing diagnostic
 * event without making this low-level path resolver depend on daemon code.
 * Callback failures cannot turn a refused path into an exception: the local
 * fallback is the fail-closed result either way.
 */
export function covenHomePath(
  env: CovenHomeEnvironment = process.env,
  homeDir: string = homedir(),
  platform: NodeJS.Platform = process.platform,
  onRemoteRefused?: CovenHomeRemoteRefusal,
): string {
  const configured = env.COVEN_HOME;
  if (configured) {
    if (!(platform === "win32" && isRemoteWindowsPath(configured))) return configured;
    try {
      onRemoteRefused?.(configured);
    } catch {
      // A diagnostic failure must not weaken the path boundary.
    }
  }
  return path.join(homeDir, ".coven");
}
