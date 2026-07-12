import { lstat } from "node:fs/promises";
import path from "node:path";
import { caveHome, covenHome } from "@/lib/coven-paths";
import { CAVE_HOME_MIGRATIONS } from "@/lib/server/cave-home-migration";

/**
 * Qualification check for the manual "Migrate now" shell banner.
 *
 * The boot-time cave home migration (instrumentation.ts) normally clears every
 * legacy `~/.coven/cave-*` entry, so a machine only *qualifies* for the banner
 * when that run errored or was interrupted and real legacy files remain:
 *
 *  - `pending`   — legacy entry is a real file/dir and its destination under
 *                  `~/.coven/cave/` is free: one `migrateCaveHome()` run moves
 *                  it. These are what the banner button fixes.
 *  - `conflicts` — legacy entry AND destination both exist. Destination wins
 *                  by design; the legacy copy is left for manual review and
 *                  never blocks the banner from clearing.
 *
 * Symlinked legacy paths are already-migrated compat bridges, not candidates.
 */
export type CaveHomeMigrationStatus = {
  pending: string[];
  conflicts: string[];
  /** True when no legacy entry remains as a real (non-symlink) path. */
  migrated: boolean;
};

async function pathState(target: string): Promise<"missing" | "symlink" | "present"> {
  try {
    const st = await lstat(target);
    return st.isSymbolicLink() ? "symlink" : "present";
  } catch {
    return "missing";
  }
}

export async function caveHomeMigrationStatus(): Promise<CaveHomeMigrationStatus> {
  const pending: string[] = [];
  const conflicts: string[] = [];
  for (const entry of CAVE_HOME_MIGRATIONS) {
    const legacyState = await pathState(path.join(covenHome(), entry.legacy));
    if (legacyState !== "present") continue;
    const nextState = await pathState(path.join(caveHome(), entry.next));
    (nextState === "missing" ? pending : conflicts).push(entry.legacy);
  }
  return {
    pending,
    conflicts,
    migrated: pending.length === 0 && conflicts.length === 0,
  };
}
