// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-projects.ts", import.meta.url), "utf8");

// When the scope (familiarId) changes or the hook re-enables, the previous
// scope's list must be dropped before the refetch resolves. Otherwise a
// familiar-scoped consumer (new-card modal, command palette) keeps showing —
// and lets the user pick — another familiar's projects during the in-flight
// request, which then 403s at the board chat-launch (assertProjectAccess).
assert.match(
  source,
  /setProjects\(\[\]\);\s*\n\s*load\(\);/,
  "useProjects clears the retained list before refetching on a scope/enable change",
);

// The clear must live in the [enabled, load] effect (load is memoized on
// familiarId), NOT inside load() itself — a manual reload() after a mutation
// calls load() directly and must not blank the list mid-refresh.
assert.doesNotMatch(
  source,
  /setLoading\(true\);\s*\n\s*setError\(null\);\s*\n\s*setProjects\(\[\]\)/,
  "the reset lives in the effect, not in load(), so in-place reload() never blanks the list",
);

// cave-v8hh: GET /api/projects is deduped through a module-level microcache —
// the hook's 8+ consumers used to fire one identical request each on a surface
// mount. Mutations must drop the cache (every scope) so no consumer can be
// served a pre-mutation list, and reload() must bypass it.
assert.match(
  source,
  /projectsCache\.get\(key, \(\) => requestProjects\(familiarId\)\)/,
  "loads go through the shared projects microcache",
);
assert.match(
  source,
  /if \(opts\?\.force\) projectsCache\.invalidate\(key\);/,
  "force drops the cached scope before refetching",
);
assert.match(
  source,
  /void load\(\{ force: true \}\);/,
  "reload() bypasses the microcache",
);
assert.equal(
  (source.match(/invalidateProjectsCache\(\);/g) ?? []).length,
  5,
  "all five mutations (create/rename/updateRoot/updateColor/delete) invalidate the cache",
);

console.log("use-projects.test.ts: ok");
