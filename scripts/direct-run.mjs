// "Am I being run directly, rather than imported?" — compared as REAL paths,
// never as URL strings.
//
// The naive spelling is `import.meta.url === `file://${process.argv[1]}``, and
// it fails three separate ways. Every one of them makes the module's `main()`
// silently never run, which is the worst possible failure mode for a guard: the
// gate reports success because it did nothing at all.
//
//   1. **no percent-encoding** — a checkout under a path containing a space
//      gives `file:///tmp/a b/x.mjs` where `import.meta.url` is
//      `file:///tmp/a%20b/x.mjs`;
//   2. **symlinks** — on macOS `/var` is a symlink to `/private/var`, so
//      `argv[1]` can be `/var/folders/…` while `import.meta.url` resolves to
//      `/private/var/folders/…`. `pathToFileURL` alone does NOT fix this;
//   3. **Windows separators and the third slash** — `argv[1]` is a backslashed
//      drive path (`C:\Users\…`) while `import.meta.url` is
//      `file:///C:/Users/…`. The naive form yields `file://C:\Users\…`, which
//      matches nothing, so on Windows these CLIs were unconditionally inert.
//
// `realpathSync` on both sides collapses all three. This lives in its own
// module because the helper was previously copy-pasted into each script that
// needed it, and that duplication is precisely what drifted: two scripts were
// repaired while `check-conflict-markers.mjs` and `generate-icon-subset.mjs`
// kept the broken spelling and went unnoticed on Windows for months
// (cave-zya). One definition, four callers — the same discipline
// `budget-headroom.mjs` exists to enforce.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} importMetaUrl the calling module's `import.meta.url`
 * @returns {boolean} true when that module is the process entry point
 */
export function isDirectRun(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    // A missing or unreadable entry path is not a direct run. Failing closed
    // here keeps an importing test from accidentally executing a CLI body.
    return false;
  }
}
