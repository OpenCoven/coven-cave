import fs from "node:fs";
import path from "node:path";
import { callDaemon } from "@/lib/coven-daemon";

/**
 * Trusted project roots for the working-tree Changes panel (/api/changes).
 *
 * The static allow-list in `project-paths.ts` only covers the Coven/OpenClaw
 * workspace dirs plus the cave's own `process.cwd()`. That leaves every chat
 * session rooted in a user's *other* repo (e.g. ~/Documents/GitHub/<proj>)
 * returning 403 — and in the packaged app even cave-repo sessions 403 because
 * `process.cwd()` is the app bundle, not the repo.
 *
 * The daemon is the right trust anchor: it already spawned a harness in each
 * session's `project_root`, so those directories are user-sanctioned. An
 * attacker can't make the daemon report a session at `/etc`, so widening the
 * allow-list to "directories the daemon has a session for" doesn't open an
 * arbitrary-path read/revert primitive — it tracks exactly what the user is
 * already running.
 */

type DaemonSession = { project_root?: string };

function realpathOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Fetch the set of session `project_root`s the daemon currently knows about,
 * canonicalized through the filesystem. Returns an empty array when the daemon
 * is offline or reports nothing — callers then fall back to the static
 * allow-list only (no widening).
 */
export async function daemonSessionRoots(): Promise<string[]> {
  const res = await callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" });
  if (!res.ok || !res.data) return [];
  const roots = new Set<string>();
  for (const session of res.data) {
    const root = session.project_root?.trim();
    if (root && path.isAbsolute(root)) {
      roots.add(realpathOrResolve(root));
    }
  }
  return [...roots];
}

/**
 * If `value` resolves to a directory at (or within) one of the daemon's known
 * session roots, return the canonicalized path; otherwise null. Pure given the
 * `roots` list, so it can be unit-tested without a live daemon.
 */
export function resolveWithinSessionRoots(value: string, roots: string[]): string | null {
  const candidate = realpathOrResolve(value);
  for (const root of roots) {
    if (isWithinRoot(candidate, root)) return candidate;
  }
  return null;
}
