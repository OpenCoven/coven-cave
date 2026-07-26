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

// cave-0g2x crash truth: first-turn stubs are statusless; the list resolves
// them against the in-process run registry — live run ⇒ running, no run ⇒
// failed (server died mid-first-turn) — instead of the "completed" default a
// conversation-only row would otherwise get.
assert.match(
  source,
  /if \(!conv\.pending\) return conv;\s*\n\s*return hasActiveChatRun\(conv\.sessionId\)\s*\n?\s*\? \{ \.\.\.conv, status: "running", exitCode: 0 \}\s*\n?\s*: \{ \.\.\.conv, status: "failed", exitCode: 1 \};/,
  "pending conversations resolve running/failed via the live-run registry",
);
assert.match(
  source,
  /import \{ hasActiveChatRun \} from "@\/lib\/server\/chat-stop-registry"/,
  "the liveness probe comes from the in-process chat run registry",
);

console.log("sessions list route.test.ts: ok");
