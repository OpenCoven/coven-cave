import assert from "node:assert/strict";
import test from "node:test";

import { nextRovingId, resolveRovingId } from "./roving-list.ts";

test("resolveRovingId keeps the current id stable across refreshes", () => {
  assert.equal(resolveRovingId(["a", "b", "c"], "b", "a"), "b");
});

test("resolveRovingId falls back to selection, then first item", () => {
  assert.equal(resolveRovingId(["a", "b", "c"], "missing", "c"), "c");
  assert.equal(resolveRovingId(["a", "b"], null, null), "a");
  assert.equal(resolveRovingId([], "a", "a"), null);
});

test("nextRovingId moves vertically and clamps at list edges", () => {
  const ids = ["a", "b", "c"];
  assert.equal(nextRovingId(ids, "a", "ArrowDown"), "b");
  assert.equal(nextRovingId(ids, "c", "ArrowDown"), "c");
  assert.equal(nextRovingId(ids, "c", "ArrowUp"), "b");
  assert.equal(nextRovingId(ids, "a", "ArrowUp"), "a");
});

test("nextRovingId supports Home and End jumps", () => {
  const ids = ["a", "b", "c"];
  assert.equal(nextRovingId(ids, "b", "Home"), "a");
  assert.equal(nextRovingId(ids, "b", "End"), "c");
});
