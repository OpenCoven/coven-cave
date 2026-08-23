export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Move legacy ~/.coven/cave-*.json state into ~/.coven/cave/ before anything
  // reads it. Store reads remain gated on this same promise, but the route
  // registry must not await it: shell delivery is independent of persistence.
  try {
    const migration = await import("@/lib/server/cave-home-migration");
    void migration.migrateCaveHomeOnce().catch((error) => {
      console.warn("[instrumentation] cave home migration failed:", error);
    });
  } catch (error) {
    console.warn("[instrumentation] cave home migration could not start:", error);
  }
  try {
    const mediaJobs = await import("@/lib/server/research-media-jobs");
    void mediaJobs.startResearchMediaJobs().catch((error) => {
      console.warn("[instrumentation] research media jobs failed to start:", error);
    });
  } catch (error) {
    console.warn("[instrumentation] research media jobs could not start:", error);
  }
  try {
    // The application-startup sweep for the bounded X post cache. Read-time
    // expiry only reaches a post someone looks up again, so without this an
    // abandoned entry keeps its text, author id and handle on disk forever
    // (cave-1tu16). Best-effort and detached: a stale cache file must never
    // hold up shell delivery, and the Research Desk load sweeps as well.
    const xSources = await import("@/lib/server/x-sources");
    void xSources.sweepExpiredXCache().catch((error) => {
      console.warn("[instrumentation] X cache sweep failed:", error);
    });
  } catch (error) {
    console.warn("[instrumentation] X cache sweep could not start:", error);
  }
  const mod = await import("@/lib/inbox-scheduler");
  mod.startScheduler();
  const watcher = await import("@/lib/github-watcher");
  watcher.startGithubWatcher();
  const backupSync = await import("@/lib/server/backup-sync");
  backupSync.startBackupSyncScheduler();
}
