import assert from "node:assert/strict";
import { runStatusColor, runStatusIcon } from "./run-status.ts";

// failed/running/queued are the same in both contexts.
assert.equal(runStatusColor("failed"), "var(--color-danger)");
assert.equal(runStatusColor("running"), "var(--accent-presence)");
assert.equal(runStatusColor("queued"), "var(--color-warning)");
assert.equal(runStatusColor("failed", { quietSuccess: true }), "var(--color-danger)");
assert.equal(runStatusColor("running", { quietSuccess: true }), "var(--accent-presence)");

// succeeded is the one intentional difference: loud (list) vs quiet (row badge).
assert.equal(runStatusColor("succeeded"), "var(--accent-presence)", "default highlights success");
assert.equal(runStatusColor("succeeded", { quietSuccess: true }), "var(--text-muted)", "quietSuccess keeps a healthy row calm");

// cancelled is a terminal outcome the daemon reports (RoutineRun vocabulary):
// calm tint in both contexts — a deliberate stop is not a failure — but a
// distinct prohibit glyph, never the unknown-status dot.
assert.equal(runStatusColor("cancelled"), "var(--text-muted)");
assert.equal(runStatusColor("cancelled", { quietSuccess: true }), "var(--text-muted)");
assert.equal(runStatusIcon("cancelled"), "ph:prohibit");

// Unknown status falls back to muted AND to the plain dot, so a cancelled run
// is never visually mistaken for "no status".
assert.equal(runStatusColor("nope"), "var(--text-muted)");
assert.equal(runStatusIcon("nope"), "ph:circle-fill");

console.log("run-status.test.ts: ok");
