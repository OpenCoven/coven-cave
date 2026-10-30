export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  let caveHomeReady: Promise<unknown> = Promise.resolve();
  // Move legacy ~/.coven/cave-*.json state into ~/.coven/cave/ before anything
  // reads it. Store reads remain gated on this same promise, but the route
  // registry must not await it: shell delivery is independent of persistence.
  try {
    const migration = await import("@/lib/server/cave-home-migration");
    caveHomeReady = migration.migrateCaveHomeOnce();
    void caveHomeReady.catch((error) => {
      console.warn("[instrumentation] cave home migration failed:", error);
    });
  } catch (error) {
    console.warn("[instrumentation] cave home migration could not start:", error);
  }
  try {
    const resources = await import("@/lib/server/research-resource-recovery");
    void caveHomeReady
      .then(() => resources.recoverInterruptedResearchResourceRestore())
      .catch((error) => {
        console.warn("[instrumentation] Research Resource restore recovery failed:", error);
      });
  } catch (error) {
    console.warn("[instrumentation] Research Resource restore recovery could not start:", error);
  }
  try {
    const research = await import("@/lib/server/research-package");
    void research.startOptionalResearch().catch((error) => {
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
    const xRuntime = await import("@/lib/server/research-runtime-privacy");
    void xRuntime.sweepResearchMissionXRuntime().catch((error) => {
      console.warn("[instrumentation] X mission runtime sweep failed:", error);
    });
  } catch (error) {
    console.warn("[instrumentation] X mission runtime sweep could not start:", error);
  }
  const shutdown = await import("@/lib/server/startup-worker-shutdown");
  const inbox = await import("@/lib/inbox-scheduler");
  if (shutdown.registerStartupWorker("inbox-reminders", inbox.stopScheduler)) {
    void inbox.startScheduler().catch(error => {
      console.warn("[instrumentation] inbox reminders failed to start:", error);
    });
  }
  const scheduledChat = await import("@/lib/server/scheduled-chat-scheduler");
  if (shutdown.registerStartupWorker("scheduled-chat", scheduledChat.stopScheduledChatScheduler)) {
    void scheduledChat.startScheduledChatScheduler().catch(error => {
      console.warn("[instrumentation] scheduled chat failed to start:", error);
    });
  }
  const watcher = await import("@/lib/github-watcher");
  void watcher.startGithubWatcher().catch((error) => {
    console.warn("[instrumentation] GitHub watcher failed to start:", error);
  });
  const backupSync = await import("@/lib/server/backup-sync");
  if (shutdown.registerStartupWorker("backup-sync", () => backupSync.stopBackupSyncScheduler({ pushOnQuit: true }))) {
    void backupSync.startBackupSyncScheduler().catch(error => {
      console.warn("[instrumentation] backup sync failed to start:", error);
    });
  }
  try {
    // The event plane's server-side watchers (#5843). They start only when
    // the plane is switched on with COVEN_CAVE_EVENT_PLANE_ENABLED=1; with it
    // off there is no daemon poll and no file watch. They publish through the
    // bridge server.ts installs before Next starts.
    const { isEventPlaneEnabled } = await import("@/lib/cave-event-plane-protocol");
    if (isEventPlaneEnabled(process.env)) {
      (await import("@/lib/server/daemon-event-watcher")).startDaemonEventWatcher();
      (await import("@/lib/server/familiar-roster-watch")).startFamiliarRosterWatch();
      (await import("@/lib/server/board-file-watch")).startBoardFileWatch();
    }
  } catch (error) {
    console.warn("[instrumentation] event plane watchers could not start:", error);
  }
}
