// @ts-nocheck
import assert from "node:assert/strict";
import { deriveProjectStatus, RECENT_ACTIVE_MS } from "./project-status.ts";

const NOW = 1_700_000_000_000;
const isoAgo = (ms) => new Date(NOW - ms).toISOString();
const sess = (over) => ({ id: "x", status: "ended", updated_at: isoAgo(0), ...over });

assert.equal(deriveProjectStatus([sess({ status: "running", updated_at: isoAgo(10 * 24 * 3600_000) })], NOW), "running");
assert.equal(deriveProjectStatus([sess({ status: "failed", updated_at: isoAgo(60_000) })], NOW), "failed");
assert.equal(deriveProjectStatus([sess({ status: "error", updated_at: isoAgo(60_000) })], NOW), "failed");
assert.equal(deriveProjectStatus([sess({ status: "ended", updated_at: isoAgo(3600_000) })], NOW), "recent");
assert.equal(deriveProjectStatus([sess({ status: "ended", updated_at: isoAgo(30 * 3600_000) })], NOW), null);
assert.equal(deriveProjectStatus([sess({ updated_at: isoAgo(RECENT_ACTIVE_MS - 1000) })], NOW), "recent");
assert.equal(deriveProjectStatus([sess({ updated_at: isoAgo(RECENT_ACTIVE_MS + 1000) })], NOW), null);
assert.equal(deriveProjectStatus([], NOW), null);
assert.equal(
  deriveProjectStatus(
    [sess({ status: "running", updated_at: isoAgo(2 * 3600_000) }), sess({ status: "failed", updated_at: isoAgo(60_000) })],
    NOW,
  ),
  "running",
);

console.log("project-status.test.ts: ok");
