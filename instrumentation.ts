export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Move legacy ~/.coven/cave-*.json state into ~/.coven/cave/ before anything
  // reads it. Best-effort by design — a failure must never block boot.
  try {
    const migration = await import("@/lib/server/cave-home-migration");
    await migration.migrateCaveHomeOnce();
  } catch (error) {
    console.warn("[instrumentation] cave home migration failed:", error);
  }
  const mod = await import("@/lib/inbox-scheduler");
  mod.startScheduler();
  const watcher = await import("@/lib/github-watcher");
  watcher.startGithubWatcher();
}
