import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { caveHome, covenHome } from "@/lib/coven-paths";
import { CAVE_HOME_MIGRATIONS } from "@/lib/server/cave-home-migration";

/**
 * Qualification check for the cave home migration shell banner.
 *
 * The boot-time cave home migration (instrumentation.ts) normally clears every
 * legacy `~/.coven/cave-*` entry, so a machine only *qualifies* for the banner
 * when that run errored or was interrupted and real legacy files remain:
 *
 *  - `pending`   — one `migrateCaveHome()` run clears it: a real legacy entry
 *                  whose destination under `~/.coven/cave/` is free, or a
 *                  legacy DIRECTORY whose children all fit the destination
 *                  (the migrator drains those per-file — cave-lzx3). These are
 *                  what the banner's "Migrate now" button fixes.
 *  - `conflicts` — legacy entry and destination both exist and can't be
 *                  auto-merged (same-name children, or a file pair).
 *                  Destination wins by design; the legacy copy is left for
 *                  manual review and surfaced as a review banner.
 *
 * Symlinked legacy paths are already-migrated compat bridges, not candidates.
 */
export type CaveHomeMigrationStatus = {
  pending: string[];
  conflicts: string[];
  /** True when no legacy entry remains as a real (non-symlink) path. */
  migrated: boolean;
};

async function pathState(target: string): Promise<"missing" | "symlink" | "file" | "dir"> {
  try {
    const st = await lstat(target);
    return st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}

/** Mirrors mergeDirEntry: `.DS_Store` never blocks a drain. */
async function dirHasCollisions(legacyDir: string, nextDir: string): Promise<boolean> {
  for (const name of await readdir(legacyDir)) {
    if (name === ".DS_Store") continue;
    if ((await pathState(path.join(nextDir, name))) !== "missing") return true;
  }
  return false;
}

export async function caveHomeMigrationStatus(): Promise<CaveHomeMigrationStatus> {
  const pending: string[] = [];
  const conflicts: string[] = [];
  for (const entry of CAVE_HOME_MIGRATIONS) {
    const legacyPath = path.join(covenHome(), entry.legacy);
    const legacyState = await pathState(legacyPath);
    if (legacyState === "missing" || legacyState === "symlink") continue;
    const nextPath = path.join(caveHome(), entry.next);
    const nextState = await pathState(nextPath);
    if (nextState === "missing") {
      pending.push(entry.legacy);
      continue;
    }
    if (legacyState === "dir" && nextState === "dir") {
      // A drainable dir pair is fixable by one run — pending, not a conflict.
      try {
        (await dirHasCollisions(legacyPath, nextPath)) ? conflicts.push(entry.legacy) : pending.push(entry.legacy);
      } catch {
        conflicts.push(entry.legacy); // unreadable dir: don't promise the button fixes it
      }
      continue;
    }
    conflicts.push(entry.legacy);
  }
  return {
    pending,
    conflicts,
    migrated: pending.length === 0 && conflicts.length === 0,
  };
}
