import fs from "node:fs";
import path from "node:path";

/**
 * Canonicalize a path through the filesystem even when it does not (fully)
 * exist, for allow-list containment checks.
 *
 * `fs.realpathSync` throws on nonexistent paths, and a plain lexical
 * `path.resolve` fallback diverges from realpathed allow-list roots whenever
 * an ancestor is a symlink. Concretely: on macOS `os.tmpdir()` lives under
 * `/var -> /private/var`, so a root canonicalizes to `/private/var/...` while
 * a nonexistent candidate beneath it lexically resolves to `/var/...` and
 * containment fails (403 instead of the intended 404). The lexical fallback
 * was also laxer than realpath for existing paths: a missing tail under a
 * symlink that escapes the root kept the pre-resolution prefix and passed
 * containment.
 *
 * This resolves the nearest existing ancestor through `realpathSync` and
 * re-appends the nonexistent tail, so candidates land in the same canonical
 * namespace as the roots — and symlink escapes are surfaced even when the
 * final segments don't exist yet. Falls back to the lexical resolution only
 * when no ancestor exists at all.
 */
export function realpathOrResolve(value: string): string {
  const resolved = path.resolve(/* turbopackIgnore: true */ value);
  try {
    return fs.realpathSync(/* turbopackIgnore: true */ resolved);
  } catch {
    /* nonexistent (or unreadable) — canonicalize via the nearest ancestor */
  }
  let ancestor = resolved;
  const tail: string[] = [];
  while (true) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    tail.unshift(path.basename(ancestor));
    ancestor = parent;
    try {
      return path.join(fs.realpathSync(/* turbopackIgnore: true */ ancestor), ...tail);
    } catch {
      /* keep walking up */
    }
  }
  return resolved;
}
