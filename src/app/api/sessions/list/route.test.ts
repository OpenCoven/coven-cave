// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /collapseFamiliarWorkspace\s*=\s*\n?\s*url\.searchParams\.get\("collapseFamiliarWorkspace"\)\s*===\s*"1"/,
  "the list route parses the opt-in collapseFamiliarWorkspace query param",
);

assert.match(
  source,
  /cacheKey\s*=[\s\S]{0,160}collapseFamiliarWorkspace\s*\?\s*"collapse"\s*:\s*"full"/,
  "the cache key varies by collapse mode so full and collapsed views never alias",
);

assert.match(
  source,
  /computeSessionsList\(includeArchived,\s*familiarId,\s*collapseFamiliarWorkspace\)/,
  "the collapse flag is threaded into computeSessionsList",
);

assert.match(
  source,
  /if \(!collapseFamiliarWorkspace\) return sessions;/,
  "the collapse helper is a no-op (and skips the FS read) when the flag is off",
);

// Regression guard for the Copilot review finding: the degraded (daemon-down,
// local-only) branch must apply the same collapse as the happy path, or a
// local chat under a familiar-workspace root leaks into the unscoped view when
// the daemon is unavailable. One helper definition + two call sites = 3 hits.
assert.equal(
  (source.match(/applyFamiliarWorkspaceCollapse\(/g) || []).length,
  3,
  "applyFamiliarWorkspaceCollapse is defined once and called in BOTH the happy and degraded paths",
);

console.log("sessions list route.test.ts: ok");
