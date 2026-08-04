import assert from "node:assert/strict";

import {
  MANUAL_FALLBACK_CODES,
  OFFICE_HOLD_CEILING_MS,
  officeStepHeld,
  shouldFallBackToManual,
  type RiteScryStatus,
} from "./rite-flow.ts";

const STATUSES: RiteScryStatus[] = ["idle", "scrying", "done", "failed"];

// ── The hold ─────────────────────────────────────────────────────────────────

assert.equal(
  officeStepHeld({ manual: false, status: "scrying" }),
  true,
  "a scry in flight is the only thing that holds the office step",
);

for (const status of STATUSES) {
  if (status === "scrying") continue;
  assert.equal(
    officeStepHeld({ manual: false, status }),
    false,
    `${status} must leave the office step open`,
  );
}

// ── It must never deadlock ───────────────────────────────────────────────────
// Every terminal state, and every escape from a non-terminal one, opens it.

assert.equal(
  officeStepHeld({ manual: false, status: "failed" }),
  false,
  "a failed scry releases the hold — the offices are simply empty",
);
assert.equal(
  officeStepHeld({ manual: false, status: "done" }),
  false,
  "a scry that came back with no usable offices still releases the hold",
);
assert.equal(
  officeStepHeld({ manual: true, status: "scrying" }),
  false,
  "manual mode is never held, even if a scry were somehow still running",
);
assert.equal(
  officeStepHeld({ manual: false, status: "scrying", waitedTooLong: true }),
  false,
  "the ceiling releases a scry that never reaches a terminal state",
);
assert.equal(
  officeStepHeld({ manual: false, status: "idle" }),
  false,
  "before an image is dropped there is nothing to wait for",
);

// Exhaustive: `scrying` before the ceiling is the ONLY held combination.
for (const manual of [false, true]) {
  for (const status of STATUSES) {
    for (const waitedTooLong of [false, true]) {
      const held = officeStepHeld({ manual, status, waitedTooLong });
      const expected = !manual && !waitedTooLong && status === "scrying";
      assert.equal(
        held,
        expected,
        `held(${manual}, ${status}, ${waitedTooLong}) should be ${expected}`,
      );
    }
  }
}

assert.ok(
  OFFICE_HOLD_CEILING_MS > 18_000 && OFFICE_HOLD_CEILING_MS < 90_000,
  "the ceiling must outlast an ordinary 12-18s scry and undercut the endpoint's 90s kill",
);

// ── Manual fallback ──────────────────────────────────────────────────────────

assert.equal(
  shouldFallBackToManual("failed", "no_local_vision_harness"),
  true,
  "no local vision harness is a permanent condition — the rite goes manual, not red",
);
assert.equal(
  shouldFallBackToManual("failed", "scry_failed"),
  false,
  "an ordinary failure stays a failure: the offices open, but this is not manual mode",
);
assert.equal(shouldFallBackToManual("failed", null), false, "a code-less failure is not a fallback");
assert.equal(
  shouldFallBackToManual("scrying", "no_local_vision_harness"),
  false,
  "only a settled scry can trigger the fallback",
);
assert.equal(
  shouldFallBackToManual("done", "no_local_vision_harness"),
  false,
  "a successful scry is never re-read as a fallback",
);
assert.ok(
  MANUAL_FALLBACK_CODES.includes("no_local_vision_harness"),
  "the 503-equivalent code the endpoint emits must be in the fallback set",
);

console.log("rite-flow: ok");
