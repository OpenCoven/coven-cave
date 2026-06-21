import assert from "node:assert/strict";
import { summarizeChecks } from "./github-checks.ts";

// ── Check-runs (GitHub Actions) take precedence over the legacy status ───────

assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "success" },
    { status: "completed", conclusion: "success" },
  ]),
  "passing",
  "all completed + success → passing",
);

assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "success" },
    { status: "completed", conclusion: "failure" },
  ]),
  "failing",
  "any completed failure → failing",
);

// Failure outranks pending: a real failed check is actionable even while a
// perpetual bot / required context is still "in progress". This is what makes
// the `failing` pip reliable in repos with never-completing checks.
assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "failure" },
    { status: "in_progress", conclusion: null },
  ]),
  "failing",
  "a real failure outranks a still-running check → failing",
);

assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "success" },
    { status: "in_progress", conclusion: null },
  ]),
  "pending",
  "no failure + a running check → pending",
);

assert.equal(
  summarizeChecks([{ status: "queued", conclusion: null }]),
  "pending",
  "queued check → pending",
);

assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "success" },
    { status: "completed", conclusion: "skipped" },
    { status: "completed", conclusion: "neutral" },
  ]),
  "passing",
  "skipped/neutral are not failures",
);

for (const bad of ["failure", "timed_out", "action_required", "startup_failure"]) {
  assert.equal(
    summarizeChecks([{ status: "completed", conclusion: bad }]),
    "failing",
    `${bad} conclusion → failing`,
  );
}

// cancelled / stale are superseded runs, NOT genuine breakage — don't flag red.
for (const benign of ["cancelled", "stale"]) {
  assert.equal(
    summarizeChecks([
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: benign },
    ]),
    "passing",
    `${benign} is not treated as a failure`,
  );
}

// ── Legacy combined-status fallback (no check-runs) ──────────────────────────

assert.equal(summarizeChecks([], "success"), "passing", "combined success → passing");
assert.equal(summarizeChecks([], "failure"), "failing", "combined failure → failing");
assert.equal(summarizeChecks([], "error"), "failing", "combined error → failing");
assert.equal(summarizeChecks([], "pending"), "pending", "combined pending → pending");

// ── No signal at all → null ──────────────────────────────────────────────────

assert.equal(summarizeChecks([]), null, "no checks + no status → null");
assert.equal(summarizeChecks([], undefined), null, "no checks + undefined status → null");
assert.equal(summarizeChecks([], "unknown_state"), null, "unrecognized combined state → null");

console.log("github-checks.test.ts OK");
