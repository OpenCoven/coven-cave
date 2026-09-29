import assert from "node:assert/strict";
import { THREAD_WARMUP_LIMIT, warmThreadTranscripts } from "./thread-warmup.ts";

function harness() {
  const idle: Array<() => void> = [];
  const fetched: string[] = [];
  const deps = {
    prefetch: async (id: string) => { fetched.push(id); if (id === "bad") throw new Error("boom"); },
    scheduleIdle: (cb: () => void) => { idle.push(cb); return () => { const i = idle.indexOf(cb); if (i >= 0) idle.splice(i, 1); }; },
  };
  const flush = async () => { while (idle.length) { idle.shift()!(); await new Promise((r) => setTimeout(r, 0)); } };
  return { deps, fetched, flush, idle };
}

// One row per idle slot, in rail order, capped, and a failure does not stop the rest.
{
  const h = harness();
  warmThreadTranscripts(["a", "bad", "c", "d", "e", "f"], h.deps);
  assert.equal(h.idle.length, 1, "only one row is scheduled at a time");
  await h.flush();
  assert.deepEqual(h.fetched, ["a", "bad", "c", "d"].slice(0, THREAD_WARMUP_LIMIT));
}

// Cancelling stops the queue and drops the pending idle slot.
{
  const h = harness();
  const cancel = warmThreadTranscripts(["a", "b", "c"], h.deps);
  h.idle.shift()!();
  await new Promise((r) => setTimeout(r, 0));
  cancel();
  await h.flush();
  assert.deepEqual(h.fetched, ["a"]);
}

console.log("thread-warmup.test.ts: ok");
