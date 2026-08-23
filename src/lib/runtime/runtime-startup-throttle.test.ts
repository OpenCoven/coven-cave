// @ts-nocheck
import assert from "node:assert/strict";
import { RuntimeStartupThrottle } from "./runtime-startup-throttle.ts";

const throttle = new RuntimeStartupThrottle(3, 1_000);
assert.deepEqual(throttle.allow(0), { allowed: true });
throttle.recordFailure(0);
throttle.recordFailure(100);
throttle.recordFailure(200);
assert.deepEqual(throttle.allow(400), { allowed: false, retryAfterMs: 600 });
assert.deepEqual(throttle.allow(1_000), { allowed: true }, "the retry window releases automatically");
throttle.recordFailure(1_000);
throttle.recordSuccess();
assert.deepEqual(throttle.allow(1_001), { allowed: true }, "a healthy readiness handshake clears crash history");

console.log("runtime-startup-throttle.test.ts: ok");
