import {
  reconcileCaveHome,
  validateCaveHomeReconciliationStore,
  withCaveHomeReconciliationLock,
  type CaveHomeReconciliationEntry,
  type CaveHomeReconciliationResult,
  type ReconciliationOptions,
} from "./cave-home-reconciliation.ts";

/**
 * Cave-owned legacy paths and their canonical names/strategies.
 *
 * Entries with schema-aware strategies are merged automatically when safe.
 * Directory children are merged by name. Every other entry is explicitly
 * manual: differing copies are backed up and left unresolved until the user
 * chooses which copy to keep. Daemon-owned ledgers and ad-hoc backups are not
 * included in this manifest.
 */
export const CAVE_HOME_MIGRATIONS: readonly CaveHomeReconciliationEntry[] = [
  { legacy: "cave-config.json", next: "config.json", strategy: "manual" },
  { legacy: "cave-state.json", next: "state.json", strategy: "state" },
  { legacy: "cave-board.json", next: "board.json", strategy: "manual" },
  { legacy: "cave-canvas.json", next: "canvas.json", strategy: "manual" },
  { legacy: "cave-inbox.json", next: "inbox.json", strategy: "inbox" },
  { legacy: "cave-inbox-prefs.json", next: "inbox-prefs.json", strategy: "manual" },
  { legacy: "cave-projects.json", next: "projects.json", strategy: "manual" },
  { legacy: "cave-project-permissions.json", next: "project-permissions.json", strategy: "manual" },
  { legacy: "cave-permission-config.json", next: "permission-config.json", strategy: "manual" },
  { legacy: "cave-automation-runs.json", next: "automation-runs.json", strategy: "manual" },
  { legacy: "cave-removed-familiars.json", next: "removed-familiars.json", strategy: "manual" },
  { legacy: "cave-preferences.json", next: "preferences.json", strategy: "preferences" },
  { legacy: "cave-preferences.json.locks", next: "preferences.json.locks", strategy: "directory" },
  { legacy: "cave-theme.json", next: "theme.json", strategy: "manual" },
  { legacy: "cave-message-feedback.json", next: "message-feedback.json", strategy: "manual" },
  { legacy: "cave-mobile-paired.json", next: "mobile-paired.json", strategy: "manual" },
  { legacy: "cave-salem-pathfinder.json", next: "salem-pathfinder.json", strategy: "manual" },
  { legacy: "cave-backdrop.jpg", next: "backdrop.jpg", strategy: "manual" },
  { legacy: "cave-conversations", next: "conversations", strategy: "directory" },
];

export type CaveHomeMigrationEntry = CaveHomeReconciliationEntry;
export type CaveHomeMigrationDirMerge = CaveHomeReconciliationResult["merged"][number];
export type CaveHomeMigrationResult = CaveHomeReconciliationResult;

/**
 * Run lossless reconciliation. All filesystem mutation is serialized through
 * a cross-process lock and committed to the durable migration journal.
 */
export async function migrateCaveHome(options: ReconciliationOptions = {}): Promise<CaveHomeMigrationResult> {
  const result = await reconcileCaveHome(CAVE_HOME_MIGRATIONS, options);
  for (const error of result.errors) console.warn(`[cave-home-migration] ${error.legacy}: ${error.error}`);
  return result;
}

declare global {
  // eslint-disable-next-line no-var
  var __caveHomeMigration: Promise<CaveHomeMigrationResult> | undefined;
}

/** One startup reconciliation per process; the durable lock/journal provide cross-process safety. */
export function migrateCaveHomeOnce(): Promise<CaveHomeMigrationResult> {
  if (!globalThis.__caveHomeMigration) {
    const run = migrateCaveHome();
    globalThis.__caveHomeMigration = run;
    void run.catch(() => {
      if (globalThis.__caveHomeMigration === run) globalThis.__caveHomeMigration = undefined;
    });
  }
  return globalThis.__caveHomeMigration;
}

/**
 * Reader/writer gate for Cave-owned stores. Unresolved divergent copies are
 * safe because canonical storage remains authoritative, but an I/O or schema
 * failure must stop a store from reading defaults and overwriting recoverable
 * legacy data.
 */
export async function ensureCaveHomeReconciled(legacy?: string): Promise<void> {
  const alreadyStarted = Boolean(globalThis.__caveHomeMigration);
  const result = await migrateCaveHomeOnce();
  let failures = legacy ? result.errors.filter((entry) => entry.legacy === legacy) : result.errors;
  if (failures.length > 0 && alreadyStarted) {
    const retry = await migrateCaveHome(legacy ? { legacy } : {});
    failures = legacy ? retry.errors.filter((entry) => entry.legacy === legacy) : retry.errors;
    if (failures.length === 0) {
      if (legacy) {
        result.errors = result.errors.filter((entry) => entry.legacy !== legacy);
      } else {
        globalThis.__caveHomeMigration = Promise.resolve(retry);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Cave home reconciliation failed for ${failures.map((entry) => entry.legacy).join(", ")}`);
  }
  if (legacy) await validateCaveHomeReconciliationStore(CAVE_HOME_MIGRATIONS, legacy);
}

/** Keep a store read or read-modify-write transaction outside migration replacements. */
export async function withCaveHomeReconciledStore<T>(
  legacy: string,
  operation: () => Promise<T>,
): Promise<T> {
  await ensureCaveHomeReconciled(legacy);
  return withCaveHomeReconciliationLock(async () => {
    // Another process may have reconciled the entry between the preflight and
    // lock acquisition. Revalidate preserved stores while we own the lock.
    await validateCaveHomeReconciliationStore(CAVE_HOME_MIGRATIONS, legacy);
    return operation();
  });
}
