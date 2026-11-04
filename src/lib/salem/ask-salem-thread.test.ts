// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASK_SALEM_THREAD_CAP,
  ASK_SALEM_THREAD_KEY,
  clearThread,
  loadThread,
  threadToMarkdown,
} from "./ask-salem-thread.ts";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    removeItem: (k) => void map.delete(k),
    has: (k) => map.has(k),
  };
}

// A thread saved by the retired surface, in its exact stored shape (#6399).
const preRetirement = [
  { role: "user", text: "What is a familiar?", at: 1_700_000_000_000 },
  { role: "salem", text: "A **governed** identity.", at: 1_700_000_001_000 },
  { role: "user", text: "A legacy turn with no timestamp" },
];

test("the storage key is unchanged, so existing threads stay readable", () => {
  assert.equal(ASK_SALEM_THREAD_KEY, "cave:ask-salem:thread:v1");
  const storage = memoryStorage({ [ASK_SALEM_THREAD_KEY]: JSON.stringify(preRetirement) });
  assert.deepEqual(loadThread(storage), preRetirement);
});

test("corrupt or foreign payloads read as empty and are not modified", () => {
  for (const raw of ["not json", "{}", "null"]) {
    const storage = memoryStorage({ [ASK_SALEM_THREAD_KEY]: raw });
    assert.deepEqual(loadThread(storage), []);
    assert.equal(storage.getItem(ASK_SALEM_THREAD_KEY), raw);
  }
  const mixed = memoryStorage({ [ASK_SALEM_THREAD_KEY]: JSON.stringify([{ role: "x", text: "no" }, preRetirement[0]]) });
  assert.deepEqual(loadThread(mixed), [preRetirement[0]]);
});

test("reads stay capped to the newest turns", () => {
  const long = Array.from({ length: ASK_SALEM_THREAD_CAP + 5 }, (_, i) => ({ role: "user", text: `t${i}` }));
  const loaded = loadThread(memoryStorage({ [ASK_SALEM_THREAD_KEY]: JSON.stringify(long) }));
  assert.equal(loaded.length, ASK_SALEM_THREAD_CAP);
  assert.equal(loaded.at(-1).text, `t${ASK_SALEM_THREAD_CAP + 4}`);
});

test("an unavailable store reads as empty and clears without throwing", () => {
  const broken = {
    getItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  assert.deepEqual(loadThread(broken), []);
  assert.doesNotThrow(() => clearThread(broken));
});

test("clearing removes the thread", () => {
  const storage = memoryStorage({ [ASK_SALEM_THREAD_KEY]: JSON.stringify(preRetirement) });
  clearThread(storage);
  assert.equal(storage.has(ASK_SALEM_THREAD_KEY), false);
});

test("export keeps every turn in order with its speaker and original time", () => {
  assert.equal(
    threadToMarkdown(preRetirement),
    [
      "# Ask Salem history\n",
      "## You (2023-11-14T22:13:20.000Z)\n\nWhat is a familiar?\n",
      "## Salem (2023-11-14T22:13:21.000Z)\n\nA **governed** identity.\n",
      "## You\n\nA legacy turn with no timestamp\n",
    ].join("\n"),
  );
});
