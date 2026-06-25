import assert from "node:assert/strict";
import { test } from "node:test";
import {
  shouldQueueInstall,
  enqueueInstall,
  nextDrainTarget,
  shouldRequeueOn409,
} from "./onboarding-install-queue.ts";

test("shouldQueueInstall: script installs never queue", () => {
  assert.equal(
    shouldQueueInstall({ kind: "script", npmBusy: true, inFlight: true, queuedCount: 5 }),
    false,
  );
});

test("shouldQueueInstall: npm runs immediately when the lane is free", () => {
  assert.equal(
    shouldQueueInstall({ kind: "npm", npmBusy: false, inFlight: false, queuedCount: 0 }),
    false,
  );
});

test("shouldQueueInstall: npm queues when busy / in-flight / already queued", () => {
  assert.equal(shouldQueueInstall({ kind: "npm", npmBusy: true, inFlight: false, queuedCount: 0 }), true);
  assert.equal(shouldQueueInstall({ kind: "npm", npmBusy: false, inFlight: true, queuedCount: 0 }), true);
  assert.equal(shouldQueueInstall({ kind: "npm", npmBusy: false, inFlight: false, queuedCount: 1 }), true);
});

test("enqueueInstall: appends, preserves order, dedupes (same ref when unchanged)", () => {
  assert.deepEqual(enqueueInstall<string>([], "a"), ["a"]);
  assert.deepEqual(enqueueInstall(["a"], "b"), ["a", "b"]);
  const q = ["a", "b"];
  // Duplicate returns the SAME reference so a React setState bails out.
  assert.equal(enqueueInstall(q, "a"), q);
});

test("nextDrainTarget: null when empty or lane not free; head otherwise", () => {
  assert.equal(nextDrainTarget<string>([], { npmBusy: false, inFlight: false }), null);
  assert.equal(nextDrainTarget(["a", "b"], { npmBusy: true, inFlight: false }), null);
  assert.equal(nextDrainTarget(["a", "b"], { npmBusy: false, inFlight: true }), null);
  assert.equal(nextDrainTarget(["a", "b"], { npmBusy: false, inFlight: false }), "a");
});

test("shouldRequeueOn409: only a 409 on an npm target re-queues", () => {
  assert.equal(shouldRequeueOn409("npm", 409), true);
  assert.equal(shouldRequeueOn409("npm", 422), false);
  assert.equal(shouldRequeueOn409("script", 409), false);
});

test("integration: 'install both' serializes coven-cli then coven-code", () => {
  // Click coven-cli (lane free → runs now), then coven-code (lane busy → queued).
  let queue: string[] = [];
  const npmBusyAfterFirst = true; // coven-cli job registered

  const firstQueued = shouldQueueInstall({ kind: "npm", npmBusy: false, inFlight: false, queuedCount: 0 });
  assert.equal(firstQueued, false, "coven-cli starts immediately");

  const secondQueued = shouldQueueInstall({ kind: "npm", npmBusy: npmBusyAfterFirst, inFlight: false, queuedCount: 0 });
  assert.equal(secondQueued, true, "coven-code waits");
  queue = enqueueInstall(queue, "coven-code");
  assert.deepEqual(queue, ["coven-code"]);

  // While coven-cli runs, nothing drains.
  assert.equal(nextDrainTarget(queue, { npmBusy: true, inFlight: false }), null);

  // coven-cli finishes → the lane frees → coven-code drains.
  const drain = nextDrainTarget(queue, { npmBusy: false, inFlight: false });
  assert.equal(drain, "coven-code");
  queue = queue.slice(1);
  assert.deepEqual(queue, []);
});

console.log("onboarding-install-queue.test.ts OK");
