import assert from "node:assert/strict";
import test from "node:test";

import { covenStopItems } from "./coven-stop-scope.ts";

test("every scope states its consequence", () => {
  const items = covenStopItems({ mode: "round-robin", currentName: "Echo", hasQueued: true });
  assert.deepEqual(items.map((i) => i.scope), ["current", "pause", "all"]);
  assert.equal(items[0].label, "Stop Echo (current)");
  assert.equal(items[0].detail, "Ends this turn; the rotation continues. Keeps what streamed.");
  assert.equal(items[1].detail, "Finishes Echo, then holds the queue.");
  assert.equal(items[2].detail, "Ends the run now. Completed and partial replies are kept.");
  // Only the last option is destructive-feeling, and the copy carries the warning.
  assert.deepEqual(items.map((i) => i.danger), [false, false, true]);
});

test("broadcast never offers to hold a queue it does not have", () => {
  const items = covenStopItems({ mode: "broadcast", currentName: "Cody", hasQueued: false });
  assert.deepEqual(items.map((i) => i.scope), ["current", "all"]);
  assert.equal(items[0].detail, "Ends this turn; others keep running. Keeps what streamed.");
});

test("pause disappears once nobody is left queued", () => {
  const items = covenStopItems({ mode: "round-robin", currentName: "Kitty", hasQueued: false });
  assert.deepEqual(items.map((i) => i.scope), ["current", "all"]);
});

test("with nothing streaming, Stop everything is still offered", () => {
  const items = covenStopItems({ mode: "round-robin", currentName: null, hasQueued: true });
  assert.deepEqual(items.map((i) => i.scope), ["pause", "all"]);
  assert.equal(items[0].detail, "Finishes the current turn, then holds the queue.");
});
