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
