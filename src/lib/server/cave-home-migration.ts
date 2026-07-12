import { lstat, mkdir, rename, symlink } from "node:fs/promises";
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

export type CaveHomeMigrationResult = {
  moved: string[];
  linked: string[];
  skipped: string[];
  errors: Array<{ legacy: string; error: string }>;
};

async function pathState(target: string): Promise<"missing" | "symlink" | "present"> {
  try {
    const st = await lstat(target);
    return st.isSymbolicLink() ? "symlink" : "present";
  } catch {
    return "missing";
  }
}

async function migrateEntry(
  entry: CaveHomeMigrationEntry,
  result: CaveHomeMigrationResult,
): Promise<void> {
  const legacyPath = path.join(covenHome(), entry.legacy);
  const nextPath = path.join(caveHome(), entry.next);

  const legacyState = await pathState(legacyPath);
  if (legacyState !== "present") {
    result.skipped.push(entry.legacy);
    return;
  }
  if ((await pathState(nextPath)) !== "missing") {
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

  // Compat bridge for external readers. Relative target so the link survives
  // a moved home dir. Best-effort: symlink creation can fail on Windows
  // without elevation — the migration itself already succeeded.
  try {
    const relativeTarget = path.relative(path.dirname(legacyPath), nextPath);
    await symlink(relativeTarget, legacyPath, entry.next === "conversations" ? "junction" : "file");
    result.linked.push(entry.legacy);
  } catch {
    /* best-effort */
  }
}

/** Run the full migration once. Safe to call repeatedly (idempotent). */
export async function migrateCaveHome(): Promise<CaveHomeMigrationResult> {
  const result: CaveHomeMigrationResult = { moved: [], linked: [], skipped: [], errors: [] };
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
