import assert from "node:assert/strict";
import {
  NEEDS_YOU,
  SESSION_LIFECYCLE,
  SESSION_LIFECYCLE_ORDER,
  compareNeedsYou,
  needsYou,
  sessionLifecycle,
  sessionLifecycleLabel,
} from "./session-lifecycle.ts";

const attention = (state: string, reason: string | null = null) =>
  ({ state, reason }) as never;

// ── The six words, and only six ───────────────────────────────────────────────
// This is the handoff's QA line: "Every status word is one of Running,
// Awaiting you, Blocked, Completed, Failed, Idle."
assert.deepEqual(
  SESSION_LIFECYCLE_ORDER.map(sessionLifecycleLabel),
  ["Running", "Awaiting you", "Blocked", "Completed", "Failed", "Idle"],
);
assert.equal(SESSION_LIFECYCLE_ORDER.length, 6, "six states, no seventh");

// ── Row tint is spent on awaiting/blocked ONLY ────────────────────────────────
// The alarm wall the handoff diagnoses came from tinting whole rows red. A
// failure keeps its badge and its spine; it does not get a field.
assert.deepEqual(
  SESSION_LIFECYCLE_ORDER.filter((s) => SESSION_LIFECYCLE[s].rowTint),
  ["awaiting", "blocked"],
);
assert.equal(SESSION_LIFECYCLE.failed.rowTint, false, "failed is a badge, never a tinted row");

// Every state derives from exactly one solid token (design language §3).
for (const state of SESSION_LIFECYCLE_ORDER) {
  assert.match(
    SESSION_LIFECYCLE[state].tint,
    /^var\(--status-[a-z]+\)$/,
    `${state} names one solid token, never a literal colour`,
  );
}

// ── Composition: daemon status × attention ────────────────────────────────────
// Failure is terminal and outranks everything, including a pending question.
assert.equal(sessionLifecycle({ status: "failed" }), "failed");
assert.equal(
  sessionLifecycle({ status: "failed", attention: attention("awaiting-human", "input") }),
  "failed",
  "a failed run is failed even when something was still being asked",
);

// Live work outranks attention.
assert.equal(sessionLifecycle({ status: "running" }), "running");
assert.equal(
  sessionLifecycle({ status: "running", attention: attention("awaiting-human", "input") }),
  "running",
);
assert.equal(sessionLifecycle({ status: "queued" }), "running", "queued reads as live work in flight");

// Attention splits into blocked vs awaiting by REASON, not by elapsed time.
assert.equal(sessionLifecycle({ status: "completed", attention: attention("awaiting-human", "input") }), "awaiting");
assert.equal(sessionLifecycle({ status: "completed", attention: attention("awaiting-human", "decision") }), "awaiting");
assert.equal(sessionLifecycle({ status: "completed", attention: attention("awaiting-human", "approval") }), "blocked");
assert.equal(sessionLifecycle({ status: "completed", attention: attention("awaiting-human", "credentials") }), "blocked");
assert.equal(sessionLifecycle({ status: "completed", attention: attention("left-hanging", null) }), "awaiting");

// "Still waiting" (overdue-human) is a LONGER WAIT, not a different state —
// and above all not an error. Duration carries the escalation; hue does not.
assert.equal(
  sessionLifecycle({ status: "completed", attention: attention("overdue-human", "input") }),
  "awaiting",
  "an overdue wait is still awaiting — never failed",
);

// Settled states.
assert.equal(sessionLifecycle({ status: "completed" }), "completed");
assert.equal(sessionLifecycle({ status: "paused" }), "idle");
assert.equal(sessionLifecycle({ status: "something-new" }), "completed", "unknown daemon states settle, never alarm");
assert.equal(sessionLifecycle({ status: null }), "completed");

// Archived sessions can want nothing from you — same rule the rail applies.
assert.equal(
  sessionLifecycle({ status: "completed", attention: attention("awaiting-human", "approval"), archived: true }),
  "completed",
);

// ── Needs-you set and its order ───────────────────────────────────────────────
assert.deepEqual([...NEEDS_YOU], ["blocked", "failed", "awaiting"]);
for (const state of ["blocked", "failed", "awaiting"] as const) assert.ok(needsYou(state));
for (const state of ["running", "completed", "idle"] as const) {
  assert.equal(needsYou(state), false, `${state} never demands attention`);
}
assert.deepEqual(
  (["awaiting", "failed", "blocked"] as const).slice().sort(compareNeedsYou),
  ["blocked", "failed", "awaiting"],
  "blocked → failed → awaiting",
);

console.log("session-lifecycle.test.ts: ok");
