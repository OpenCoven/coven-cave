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

console.log("use-projects.test.ts: ok");
