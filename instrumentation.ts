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
  try {
    // Crash residue sweep for just-in-time X mission hydration. Every in-process
    // path removes `<mission>/runtime/x` when a run settles, but a process that
    // is killed mid-iteration never reaches one — and that temporary post text
    // must not survive on disk. Age-gated inside the sweep so a run started by
    // another live process is never robbed (cave-v3ajh). Detached and
    // best-effort: the next launch purges before it hydrates, so a failure here
    // is retried rather than fatal to shell delivery.
    const xRuntime = await import("@/lib/server/research-mission-x-runtime");
    void xRuntime.sweepResearchMissionXRuntime().catch((error) => {
      console.warn("[instrumentation] X mission runtime sweep failed:", error);
    });
  } catch (error) {
    console.warn("[instrumentation] X mission runtime sweep could not start:", error);
  }
  const mod = await import("@/lib/inbox-scheduler");
  mod.startScheduler();
  const watcher = await import("@/lib/github-watcher");
  watcher.startGithubWatcher();
  const backupSync = await import("@/lib/server/backup-sync");
  backupSync.startBackupSyncScheduler();
}
