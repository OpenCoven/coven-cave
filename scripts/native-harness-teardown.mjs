// Fixture-root removal for the runtime activity harnesses (#6340).
//
// Each harness removes its temporary root only after it has proven every
// owner stopped: Cave server, provider, daemon (pid gone, no daemon.json or
// socket). Even then a late write under the Cave state directory can land
// between the recursive walk and the final rmdir, and `rm` throws ENOTEMPTY.
// Thrown out of a harness's `finally`, that crash lost `result.json` for a
// run whose suite had passed. This helper retries with linear backoff, and
// when the write persists it reports what is under the directory `rm` could
// not empty instead of throwing, so the run fails with evidence rather than
// without it. The caller decides how to record the failure.
import { readdir as readdirDefault, rm as rmDefault } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as waitDefault } from "node:timers/promises";

/** Bounded so a runaway writer cannot turn the report into a directory dump. */
export const LATE_WRITE_LISTING_LIMIT = 50;

/**
 * @param {string} root the fixture root to remove
 * @param {object} [options]
 * @param {typeof rmDefault} [options.rm]
 * @param {typeof readdirDefault} [options.readdir]
 * @param {number} [options.maxRetries] rm's own retry budget for EBUSY/ENOTEMPTY/EPERM
 * @param {number} [options.retryDelay] linear backoff step in milliseconds
 * @returns {Promise<{removed: true} | {removed: false, code: string, path: string, message: string, entries: string[] | null, truncated: boolean}>}
 *   `entries` lists paths relative to `path`, recursively, sorted and capped
 *   at LATE_WRITE_LISTING_LIMIT; `[]` means the directory was empty by the
 *   time it was listed (a transient writer), `null` means it could not be
 *   listed at all.
 */
export async function removeFixtureRoot(root, {
  rm = rmDefault, readdir = readdirDefault, maxRetries = 5, retryDelay = 200,
} = {}) {
  if (typeof root !== "string" || root.length === 0) {
    throw new TypeError("removeFixtureRoot needs the fixture root path");
  }
  try {
    await rm(root, { recursive: true, force: true, maxRetries, retryDelay });
    return { removed: true };
  } catch (error) {
    const offending = typeof error?.path === "string" && error.path.length > 0 ? error.path : root;
    let entries = null;
    let truncated = false;
    try {
      const listed = (await readdir(offending, { recursive: true })).map(String).sort();
      truncated = listed.length > LATE_WRITE_LISTING_LIMIT;
      entries = truncated ? listed.slice(0, LATE_WRITE_LISTING_LIMIT) : listed;
    } catch {
      entries = null;
    }
    return {
      removed: false,
      code: typeof error?.code === "string" ? error.code : "UNKNOWN",
      path: offending,
      message: error instanceof Error ? error.message : String(error),
      entries,
      truncated,
    };
  }
}

/**
 * The record a harness stores in its report when the root could not be
 * removed, in the shape every harness shares.
 */
export function lateWriteRecord(removal) {
  return {
    code: removal.code, path: removal.path, message: removal.message,
    entries: removal.entries, truncated: removal.truncated,
  };
}

/**
 * Observe only the recorded owned PID, after the caller's stop command succeeds.
 * Acknowledgement/socket EOF is not process exit. Only ESRCH within one
 * monotonic five-second budget permits the caller to remove fixture state.
 * Signal zero observes existence; this helper never terminates a process.
 */
export async function observeOwnedProcessExit(pid, {
  probe = (ownedPid) => process.kill(ownedPid, 0),
  now = () => performance.now(), wait = waitDefault,
} = {}) {
  const budgetMs = 5_000;
  const pollIntervalMs = 50;
  const started = now();
  let probes = 0;
  const result = (status, error, hasError = false) => ({
    pid: Number.isSafeInteger(pid) ? pid : null,
    disappeared: status === "absent", status, budgetMs, pollIntervalMs,
    probes, elapsedMs: Math.max(0, now() - started),
    ...(hasError ? { error: {
      code: typeof error?.code === "string" ? error.code : "UNKNOWN",
      message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    } } : {}),
  });
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647) {
    return result("invalid-pid");
  }
  while (now() - started < budgetMs) {
    let failure;
    let probeFailed = false;
    ++probes;
    try { probe(pid); } catch (error) { failure = error; probeFailed = true; }
    // Probe and scheduling costs consume the same deadline. A late ESRCH
    // cannot retroactively establish disappearance within the budget.
    if (now() - started >= budgetMs) return result("timeout", failure, probeFailed);
    if (probeFailed) return result(failure?.code === "ESRCH" ? "absent" : "probe-error", failure, true);
    try { await wait(Math.min(pollIntervalMs, budgetMs - (now() - started))); }
    catch (error) { return result("observation-error", error, true); }
  }
  return result("timeout");
}
