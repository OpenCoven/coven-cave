// @ts-nocheck
// The point of waitFor is that it removes a race WITHOUT removing the
// assertion: it must still fail when the awaited thing never happens.
import assert from "node:assert/strict";
import { test } from "node:test";

import { waitFor } from "./wait-for.ts";

test("returns immediately when the condition already holds", async () => {
  const started = Date.now();
  await waitFor(() => true, { timeoutMs: 1000 });
  assert.ok(Date.now() - started < 50, "an already-satisfied wait costs no wall clock");
});

test("resolves once the condition becomes true", async () => {
  let ready = false;
  setTimeout(() => {
    ready = true;
  }, 30);
  await waitFor(() => ready, { timeoutMs: 2000, intervalMs: 2 });
  assert.equal(ready, true);
});

test("still fails when the condition never holds — the assertion is not weakened", async () => {
  await assert.rejects(
    () => waitFor(() => false, { timeoutMs: 30, intervalMs: 5, describe: "a thing that never happens" }),
    /timed out after 30ms waiting for a thing that never happens/,
  );
});

test("accepts an async condition", async () => {
  let hits = 0;
  await waitFor(async () => ++hits >= 3, { timeoutMs: 1000, intervalMs: 1 });
  assert.equal(hits, 3);
});

test("a slow condition does not fail early — the ceiling is wall clock, not attempts", async () => {
  const started = Date.now();
  let ready = false;
  setTimeout(() => {
    ready = true;
  }, 60);
  await waitFor(() => ready, { timeoutMs: 2000, intervalMs: 10 });
  assert.ok(Date.now() - started >= 55, "waited for the real event rather than a guess");
});
