import assert from "node:assert/strict";
import { runStatusColor } from "./run-status.ts";

// failed/running/queued are the same in both contexts.
assert.equal(runStatusColor("failed"), "var(--color-danger)");
assert.equal(runStatusColor("running"), "var(--accent-presence)");
assert.equal(runStatusColor("queued"), "var(--color-warning)");
assert.equal(runStatusColor("failed", { quietSuccess: true }), "var(--color-danger)");
assert.equal(runStatusColor("running", { quietSuccess: true }), "var(--accent-presence)");

// succeeded is the one intentional difference: loud (list) vs quiet (row badge).
assert.equal(runStatusColor("succeeded"), "var(--accent-presence)", "default highlights success");
assert.equal(runStatusColor("succeeded", { quietSuccess: true }), "var(--text-muted)", "quietSuccess keeps a healthy row calm");

// Unknown status falls back to muted.
assert.equal(runStatusColor("nope"), "var(--text-muted)");

console.log("run-status.test.ts: ok");
