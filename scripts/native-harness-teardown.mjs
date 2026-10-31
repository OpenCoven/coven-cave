// Fixture-root removal for the native transport harness (#6340).
//
// The harness removes its temporary root only after it has proven every owner
// stopped: Cave server, provider, daemon (pid gone, no daemon.json or socket).
// Even then a late write under the Cave state directory can land between the
// recursive walk and the final rmdir, and `rm` throws ENOTEMPTY. Thrown out of
// the harness's `finally`, that crash lost `result.json` for a run whose suite
// had passed. This helper retries with linear backoff, and when the write
// persists it preserves the root and reports what was written instead of
// throwing, so the run fails with evidence rather than without it.
import { readdir as readdirDefault, rm as rmDefault } from "node:fs/promises";

/**
 * @param {string} root the fixture root to remove
 * @param {object} [options]
 * @param {typeof rmDefault} [options.rm]
 * @param {typeof readdirDefault} [options.readdir]
 * @param {number} [options.maxRetries] rm's own retry budget for EBUSY/ENOTEMPTY/EPERM
 * @param {number} [options.retryDelay] linear backoff step in milliseconds
 * @returns {Promise<{removed: true} | {removed: false, preservedRoot: string, code: string, path: string, entries: string[] | null, message: string}>}
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
    try {
      entries = [...await readdir(offending)].sort();
    } catch {
      entries = null;
    }
    return {
      removed: false,
      preservedRoot: root,
      code: typeof error?.code === "string" ? error.code : "UNKNOWN",
      path: offending,
      entries,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
