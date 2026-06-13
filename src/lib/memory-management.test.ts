// src/lib/memory-management.test.ts
import assert from "node:assert/strict";
import { parseRelativeTime } from "./memory-management.ts";

// Anchor "now" so the test is deterministic.
const NOW = 1_000_000_000_000;

assert.equal(parseRelativeTime("5m ago", NOW), NOW - 5 * 60_000, "5m ago");
assert.equal(parseRelativeTime("2h ago", NOW), NOW - 2 * 3_600_000, "2h ago");
assert.equal(parseRelativeTime("3d ago", NOW), NOW - 3 * 86_400_000, "3d ago");
assert.equal(parseRelativeTime("just now", NOW), NOW, "just now");
assert.equal(parseRelativeTime("garbage", NOW), 0, "unparseable -> 0");

console.log("memory-management.test: ok");
