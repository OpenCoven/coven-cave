// @ts-nocheck
import assert from "node:assert/strict";
import {
  parseTweetRef,
  compactAge,
  formatStars,
} from "./home-feed.ts";

// parseTweetRef — handle + status id, host normalization, tracking strip.
const t1 = parseTweetRef("https://twitter.com/jack/status/20?s=20");
assert.equal(t1.handle, "@jack");
assert.equal(t1.statusId, "20");
assert.equal(t1.url, "https://x.com/jack/status/20", "normalized to x.com, query stripped");
const t2 = parseTweetRef("https://x.com/OpenAI/status/1234567890123456789");
assert.equal(t2.handle, "@OpenAI");
assert.equal(t2.statusId, "1234567890123456789");
assert.equal(parseTweetRef("https://example.com/jack/status/20"), null, "non-twitter host rejected");
// Profile URL: no status id, but still a valid x.com ref.
const t3 = parseTweetRef("https://x.com/jack");
assert.equal(t3.handle, "@jack");
assert.equal(t3.statusId, null);

// compactAge
const now = Date.parse("2026-06-25T12:00:00.000Z");
assert.equal(compactAge(null, now), null);
assert.equal(compactAge("2026-06-25T11:59:30.000Z", now), "now");
assert.equal(compactAge("2026-06-25T11:30:00.000Z", now), "30m");
assert.equal(compactAge("2026-06-25T09:00:00.000Z", now), "3h");
assert.equal(compactAge("2026-06-22T12:00:00.000Z", now), "3d");

// formatStars
assert.equal(formatStars(0), "0");
assert.equal(formatStars(999), "999");
assert.equal(formatStars(1500), "1.5k");
assert.equal(formatStars(23000), "23k");
assert.equal(formatStars(1_500_000), "1.5M");

console.log("home-feed.test.ts: ok");
