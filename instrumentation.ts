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
  const mod = await import("@/lib/inbox-scheduler");
  mod.startScheduler();
  const watcher = await import("@/lib/github-watcher");
  watcher.startGithubWatcher();
}
