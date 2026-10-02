import assert from "node:assert/strict";
import { test } from "node:test";
import { createChangesLedger } from "./worktree-changes-ledger.ts";

test("A → B → A: the first A answer, arriving last, is refused and touches nothing", () => {
  const ledger = createChangesLedger();
  ledger.newGeneration(); // A
  const firstA = ledger.begin()!;
  ledger.newGeneration(); // B
  const b = ledger.begin()!;
  assert.ok(b, "B may start at once: A's request is not B's");
  ledger.newGeneration(); // A again
  const secondA = ledger.begin()!;
  assert.ok(secondA, "the newer A starts at once too");

  // The newer A answers first and applies.
  assert.equal(ledger.accepts(secondA), true);
  // Then the original A answer lands: refused, though it is for "A".
  assert.equal(ledger.accepts(firstA), false);
  assert.equal(ledger.accepts(b), false);
});

test("a stale ticket ending never frees the current request's slot or takes its queued reload", () => {
  const ledger = createChangesLedger();
  ledger.newGeneration();
  const stale = ledger.begin()!;
  ledger.newGeneration();
  const current = ledger.begin()!;
  assert.equal(ledger.begin(), null, "one request at a time per generation");
  assert.deepEqual(ledger.end(stale), { reload: false }, "the stale end takes no queued reload");
  assert.equal(ledger.begin(), null, "and the current request is still in flight");
  assert.deepEqual(ledger.end(current), { reload: true }, "the queued reload goes to the current request");
  assert.ok(ledger.begin(), "the slot is free again");
});

test("forced asks during a request queue one reload; shared polls do not", () => {
  const ledger = createChangesLedger();
  ledger.newGeneration();
  const ticket = ledger.begin()!;
  assert.equal(ledger.begin({ shared: true }), null);
  assert.deepEqual(ledger.end(ticket), { reload: false }, "a skipped poll queues nothing");
  const again = ledger.begin()!;
  ledger.begin();
  ledger.begin();
  assert.deepEqual(ledger.end(again), { reload: true }, "many asks, one reload");
  const reload = ledger.begin()!;
  assert.deepEqual(ledger.end(reload), { reload: false });
});

test("a root change drops a reload queued for the old root", () => {
  const ledger = createChangesLedger();
  ledger.newGeneration();
  const old = ledger.begin()!;
  ledger.begin(); // queue
  ledger.newGeneration();
  assert.deepEqual(ledger.end(old), { reload: false });
  const fresh = ledger.begin()!;
  assert.deepEqual(ledger.end(fresh), { reload: false }, "nothing was carried over");
});
