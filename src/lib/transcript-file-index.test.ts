import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TRANSCRIPT_FILE_INDEX_ROOTS,
  boundedTranscriptFileRoots,
  loadTranscriptFileRefIndexes,
} from "./transcript-file-index.ts";

test("transcript roots retain only the most recent bounded unique roots", () => {
  const roots = Array.from(
    { length: MAX_TRANSCRIPT_FILE_INDEX_ROOTS + 4 },
    (_, index) => `/repo/${index}`,
  );
  roots.push("/repo/5");

  const bounded = boundedTranscriptFileRoots(roots);

  assert.equal(bounded.length, MAX_TRANSCRIPT_FILE_INDEX_ROOTS);
  assert.equal(bounded.at(-1), "/repo/5", "a reused root becomes most recent");
  assert.equal(bounded.includes("/repo/0"), false, "old transcript roots are evicted");
});

test("file-index loads cap request concurrency", async () => {
  let active = 0;
  let peak = 0;
  const controller = new AbortController();
  const indexes = await loadTranscriptFileRefIndexes({
    roots: ["/a", "/b", "/c", "/d", "/e"],
    signal: controller.signal,
    load: async (root) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return new Set([`${root}/file.ts`]);
    },
  });

  assert.equal(peak, 2);
  assert.equal(indexes.size, 5);
});

test("aborted scope ignores a stale completion and starts no more work", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const controller = new AbortController();
  const loading = loadTranscriptFileRefIndexes({
    roots: ["/old", "/never-started"],
    concurrency: 1,
    signal: controller.signal,
    load: async (root) => {
      calls.push(root);
      await gate;
      return new Set(["stale.ts"]);
    },
  });

  await Promise.resolve();
  controller.abort();
  release();

  assert.equal((await loading).size, 0);
  assert.deepEqual(calls, ["/old"]);
});
