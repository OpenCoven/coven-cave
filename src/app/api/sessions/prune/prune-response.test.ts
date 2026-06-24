import assert from "node:assert/strict";
import { prunePayload, type PruneResponseBody } from "./prune-response.ts";

// Regression guard for the Maintenance "Check" → Delete flow (onboarding
// overlay). The panel reads the dry-run count from `wouldPrune`; the
// daemon-native path used to return it under `pruned`, leaving `wouldPrune`
// undefined → "Nothing to prune" → the Delete button never appeared, so a
// prune could never run. Both response paths now funnel through prunePayload,
// so this exercises the exact contract the UI depends on.

function has(body: PruneResponseBody, key: string): unknown {
  return (body as Record<string, unknown>)[key];
}

for (const method of ["daemon", "client"] as const) {
  // Dry run: count under wouldPrune, pruned pinned to 0 — for BOTH paths.
  const dry = prunePayload({ dryRun: true, count: 7, method });
  assert.equal(dry.wouldPrune, 7, `${method}: dry run surfaces the count under wouldPrune`);
  assert.equal(dry.pruned, 0, `${method}: dry run reports pruned 0`);
  assert.equal(has(dry, "dryRun"), true, `${method}: dry run flagged`);
  assert.equal(dry.method, method);
  assert.equal(dry.ok, true);
  // The specific pre-fix bug: the count must NOT leak into `pruned` (which is
  // what made wouldPrune undefined for the UI).
  assert.notEqual(dry.pruned, 7, `${method}: dry-run count must not land in pruned`);

  // Real run: deletions under pruned, no wouldPrune.
  const real = prunePayload({ dryRun: false, count: 7, method });
  assert.equal(real.pruned, 7, `${method}: real run reports deletions under pruned`);
  assert.equal(has(real, "wouldPrune"), undefined, `${method}: real run has no wouldPrune`);
  assert.equal(has(real, "dryRun"), undefined, `${method}: real run is not flagged dry`);
  assert.equal(real.method, method);
  assert.equal(real.ok, true);
}

// Zero candidates on a dry run is still a valid count (0), not a missing field —
// the UI shows "Nothing to prune" from wouldPrune === 0, not from undefined.
const none = prunePayload({ dryRun: true, count: 0, method: "daemon" });
assert.equal(none.wouldPrune, 0);
assert.equal(none.pruned, 0);

console.log("prune-response: all assertions passed");
