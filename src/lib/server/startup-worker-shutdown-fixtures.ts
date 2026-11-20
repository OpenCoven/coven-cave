// Test support for the coordinated startup-worker shutdown (#6352).
// The coordinator waits on every fixed worker slot, so a test that exercises
// one owner must still register the rest. Registering them here keeps the
// tests unchanged when the fixed set grows.
import { registerStartupWorker, STARTUP_WORKERS } from "./startup-worker-shutdown";

type StartupWorker = (typeof STARTUP_WORKERS)[number];

/**
 * Register an immediately draining stop for every fixed startup worker not
 * named. The test registers the named workers itself, or leaves them
 * unavailable on purpose. Coordinator state is process-global, so this also
 * reaches a module instance a test re-imported after `vi.resetModules()`.
 */
export function registerAllStartupWorkersExcept(...names: StartupWorker[]): void {
  for (const name of STARTUP_WORKERS) {
    if (!names.includes(name)) registerStartupWorker(name, async () => undefined);
  }
}
