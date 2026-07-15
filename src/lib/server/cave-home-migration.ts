import { lstat, mkdir, readdir, rename, rm, rmdir, symlink } from "node:fs/promises";
import path from "node:path";
import { caveHome, covenHome } from "@/lib/coven-paths";

/**
 * Startup migration of cave-owned state into the dedicated cave home.
 *
 * Historically Cave scattered its files across the top level of `~/.coven`
 * as `cave-*.json` siblings of daemon-owned state. `migrateCaveHome()` moves
 * each of those into `caveHome()` (default `~/.coven/cave/`) under a
 * standardized name, then leaves a best-effort relative symlink at the legacy
 * path so external readers (daemon surfaces, scripts, older builds) keep
 * resolving until they catch up.
 *
 * Deliberately NOT migrated: files owned by other processes that merely share
 * the `cave-` prefix — `cave-calendar.json`, `cave-coven-calls.json`,
 * `cave-voice-calls.json` (daemon ledgers) — and ad-hoc user backups
 * (`*.bak.*`, `*.smoke-backup-*`).
 *
 * Semantics per entry (idempotent, crash-safe):
 *  - legacy path missing            → nothing to do
 *  - legacy path is a symlink       → already migrated (or user-bridged); skip
 *  - legacy AND destination are both real directories
 *                                   → per-file merge: children that only exist
 *                                     on the legacy side move over (lossless —
 *                                     each conversation is its own file);
 *                                     same-name children keep the destination
 *                                     copy. A fully drained legacy dir is
 *                                     replaced by the compat symlink.
 *  - destination already exists     → destination wins; legacy left untouched
 *  - otherwise                      → rename(legacy → cave/<name>), then
 *                                     best-effort compat symlink at legacy
 *
 * Every step is best-effort: a single failed entry is recorded and skipped so
 * one bad file can never block server boot or the rest of the migration.
 */

export type CaveHomeMigrationEntry = {
  /** Name under `covenHome()` (legacy location). */
  legacy: string;
  /** Standardized name under `caveHome()`. */
  next: string;
};

export const CAVE_HOME_MIGRATIONS: readonly CaveHomeMigrationEntry[] = [
  { legacy: "cave-config.json", next: "config.json" },
  { legacy: "cave-state.json", next: "state.json" },
  { legacy: "cave-board.json", next: "board.json" },
  { legacy: "cave-canvas.json", next: "canvas.json" },
  { legacy: "cave-inbox.json", next: "inbox.json" },
  { legacy: "cave-inbox-prefs.json", next: "inbox-prefs.json" },
  { legacy: "cave-projects.json", next: "projects.json" },
  { legacy: "cave-project-permissions.json", next: "project-permissions.json" },
  { legacy: "cave-permission-config.json", next: "permission-config.json" },
  { legacy: "cave-automation-runs.json", next: "automation-runs.json" },
  { legacy: "cave-removed-familiars.json", next: "removed-familiars.json" },
  { legacy: "cave-preferences.json", next: "preferences.json" },
  // Write-intent sidecar dir for preferences (see preferences-store.ts).
  { legacy: "cave-preferences.json.locks", next: "preferences.json.locks" },
  { legacy: "cave-theme.json", next: "theme.json" },
  { legacy: "cave-message-feedback.json", next: "message-feedback.json" },
  { legacy: "cave-mobile-paired.json", next: "mobile-paired.json" },
  { legacy: "cave-salem-pathfinder.json", next: "salem-pathfinder.json" },
  { legacy: "cave-backdrop.jpg", next: "backdrop.jpg" },
  { legacy: "cave-conversations", next: "conversations" },
];

export type CaveHomeMigrationDirMerge = {
  /** Legacy dir name under `covenHome()`. */
  legacy: string;
  /** Children moved out of the legacy dir into its destination. */
  files: number;
  /** Same-name children left behind (destination copy wins per file). */
  collisions: number;
};

export type CaveHomeMigrationResult = {
  moved: string[];
  linked: string[];
  skipped: string[];
  merged: CaveHomeMigrationDirMerge[];
  errors: Array<{ legacy: string; error: string }>;
};

async function pathState(target: string): Promise<"missing" | "symlink" | "file" | "dir"> {
  try {
    const st = await lstat(target);
    return st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}

// Compat bridge for external readers. Relative target so the link survives a
// moved home dir. Best-effort: symlink creation can fail on Windows without
// elevation — the migration itself already succeeded.
async function bridgeLegacyPath(
  entry: CaveHomeMigrationEntry,
  legacyPath: string,
  nextPath: string,
  kind: "file" | "dir",
  result: CaveHomeMigrationResult,
): Promise<void> {
  try {
    const relativeTarget = path.relative(path.dirname(legacyPath), nextPath);
    await symlink(relativeTarget, legacyPath, kind === "dir" ? "junction" : "file");
    result.linked.push(entry.legacy);
  } catch {
    /* best-effort */
  }
}

/**
 * Both sides of a directory entry exist — e.g. an old build recreated
 * `cave-conversations/` after migration (cave-lzx3). Children are independent
 * files keyed by name, so legacy-only ones move over losslessly; same-name
 * children keep the destination copy (the same destination-wins rule applied
 * per file) and hold the legacy dir open for review.
 */
async function mergeDirEntry(
  entry: CaveHomeMigrationEntry,
  legacyPath: string,
  nextPath: string,
  result: CaveHomeMigrationResult,
): Promise<void> {
  const merge: CaveHomeMigrationDirMerge = { legacy: entry.legacy, files: 0, collisions: 0 };
  try {
    for (const name of await readdir(legacyPath)) {
      // Finder metadata must never hold the compat bridge hostage.
      if (name === ".DS_Store") {
        await rm(path.join(legacyPath, name), { force: true });
        continue;
      }
      if ((await pathState(path.join(nextPath, name))) === "missing") {
        try {
          await rename(path.join(legacyPath, name), path.join(nextPath, name));
          merge.files += 1;
        } catch (error) {
          result.errors.push({ legacy: `${entry.legacy}/${name}`, error: String(error) });
        }
      } else {
        merge.collisions += 1;
      }
    }
    result.merged.push(merge);
    if ((await readdir(legacyPath)).length === 0) {
      await rmdir(legacyPath);
      result.moved.push(entry.legacy);
      await bridgeLegacyPath(entry, legacyPath, nextPath, "dir", result);
    } else {
      result.skipped.push(entry.legacy);
    }
  } catch (error) {
    result.errors.push({ legacy: entry.legacy, error: String(error) });
  }
}

async function migrateEntry(
  entry: CaveHomeMigrationEntry,
  result: CaveHomeMigrationResult,
): Promise<void> {
  const legacyPath = path.join(covenHome(), entry.legacy);
  const nextPath = path.join(caveHome(), entry.next);

  const legacyState = await pathState(legacyPath);
  if (legacyState === "missing" || legacyState === "symlink") {
    result.skipped.push(entry.legacy);
    return;
  }
  const nextState = await pathState(nextPath);

  if (nextState !== "missing") {
    if (legacyState === "dir" && nextState === "dir") {
      await mergeDirEntry(entry, legacyPath, nextPath, result);
      return;
    }
    // Destination wins — a newer build already wrote there. Leave the legacy
    // file for the user to inspect rather than clobbering either side.
    result.skipped.push(entry.legacy);
    return;
  }

  try {
    await rename(legacyPath, nextPath);
    result.moved.push(entry.legacy);
  } catch (error) {
    result.errors.push({ legacy: entry.legacy, error: String(error) });
    return;
  }

  await bridgeLegacyPath(entry, legacyPath, nextPath, legacyState, result);
}

/** Run the full migration once. Safe to call repeatedly (idempotent). */
export async function migrateCaveHome(): Promise<CaveHomeMigrationResult> {
  const result: CaveHomeMigrationResult = { moved: [], linked: [], skipped: [], merged: [], errors: [] };
  try {
    await mkdir(caveHome(), { recursive: true });
  } catch (error) {
    result.errors.push({ legacy: "(cave home)", error: String(error) });
    return result;
  }
  for (const entry of CAVE_HOME_MIGRATIONS) {
    await migrateEntry(entry, result);
  }
  if (result.moved.length > 0) {
    console.log(
      `[cave-home-migration] moved ${result.moved.length} legacy file(s) into ${caveHome()}: ${result.moved.join(", ")}`,
    );
  }
  for (const merge of result.merged) {
    if (merge.files > 0 || merge.collisions > 0) {
      console.log(
        `[cave-home-migration] merged ${merge.files} file(s) from ${merge.legacy} into ${caveHome()}` +
          (merge.collisions > 0 ? ` (${merge.collisions} name collision(s) left for review)` : ""),
      );
    }
  }
  for (const failure of result.errors) {
    console.warn(`[cave-home-migration] ${failure.legacy}: ${failure.error}`);
  }
  return result;
}

// One migration per process; survives Next dev hot-reloads via globalThis.
declare global {
  // eslint-disable-next-line no-var
  var __caveHomeMigration: Promise<CaveHomeMigrationResult> | undefined;
}

export function migrateCaveHomeOnce(): Promise<CaveHomeMigrationResult> {
  globalThis.__caveHomeMigration ??= migrateCaveHome();
  return globalThis.__caveHomeMigration;
}
