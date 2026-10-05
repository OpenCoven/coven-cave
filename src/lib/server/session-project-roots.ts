import path from "node:path";
import { callDaemonConditional } from "@/lib/coven-daemon";
import { realpathOrResolve } from "@/lib/server/canonical-path";

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

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** How long a read of the roots answers callers that accept a kept one. */
export const SESSION_ROOTS_KEPT_MS = 5_000;

let kept: { roots: string[]; at: number } | null = null;
let reading: Promise<string[]> | null = null;
/** Roots per session list the daemon sent, so an unchanged list (a 304)
 *  isn't canonicalized again, one real path per session. */
const rootsOfList = new WeakMap<object, string[]>();

/**
 * Fetch the set of session `project_root`s the daemon currently knows about,
 * canonicalized through the filesystem. Returns an empty array when the daemon
 * is offline or reports nothing — callers then fall back to the static
 * allow-list only (no widening).
 *
 * Every poll of a repository outside the static allow-list read the daemon's
 * whole session list (#5795): 9.2 MB and 390 ms a poll with 20,000 sessions.
 * The read is conditional (ETag), so an unchanged list is neither sent nor
 * parsed, and callers passing `maxAgeMs` take a read that recent. Reads in
 * flight are shared. A failed read is never kept.
 */
export async function daemonSessionRoots({ maxAgeMs = 0 }: { maxAgeMs?: number } = {}): Promise<string[]> {
  if (kept && maxAgeMs > 0 && Date.now() - kept.at < maxAgeMs) return kept.roots;
  reading ??= readDaemonSessionRoots().finally(() => {
    reading = null;
  });
  return reading;
}

async function readDaemonSessionRoots(): Promise<string[]> {
  const res = await callDaemonConditional<DaemonSession[]>({ path: "/api/v1/sessions" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  let roots = rootsOfList.get(res.data);
  if (!roots) {
    const unique = new Set<string>();
    for (const session of res.data) {
      const root = session.project_root?.trim();
      if (root && path.isAbsolute(root)) {
        unique.add(realpathOrResolve(root));
      }
    }
    roots = [...unique];
    rootsOfList.set(res.data, roots);
  }
  kept = { roots, at: Date.now() };
  return roots;
}

/** Test seam: forget the kept roots. */
export function clearDaemonSessionRoots(): void {
  kept = null;
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
