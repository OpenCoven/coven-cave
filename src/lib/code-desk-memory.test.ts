import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodeDeskMemoryStore } from "./code-desk-memory.ts";

const tabs = (...paths: string[]) => ({ paths, active: paths.at(-1) ?? null });

test("a session's tabs, ticks and draft survive a round trip and stay separate per session", () => {
  const store = createCodeDeskMemoryStore();
  store.write("s-new", { openFiles: tabs("/r/a.ts", "/r/b.ts"), viewed: { "a.ts": "modified:1:0" }, draft: "half-written" });
  store.write("s-old", { draft: "other session" });
  assert.deepEqual(store.read("s-new"), {
    openFiles: tabs("/r/a.ts", "/r/b.ts"),
    viewed: { "a.ts": "modified:1:0" },
    draft: "half-written",
  });
  assert.equal(store.read("s-old")?.draft, "other session");
  assert.deepEqual(store.read("s-old")?.openFiles, { paths: [], active: null });
  assert.equal(store.read("missing"), null);
});

test("partial writes merge, and an entry with nothing left in it is dropped", () => {
  const store = createCodeDeskMemoryStore();
  store.write("s1", { draft: "x", openFiles: tabs("/r/a.ts") });
  store.write("s1", { draft: "" });
  assert.deepEqual(store.read("s1")?.openFiles, tabs("/r/a.ts"), "clearing the draft keeps the tabs");
  store.write("s1", { openFiles: tabs() });
  assert.equal(store.read("s1"), null, "an all-empty entry is not held");
  assert.equal(store.size(), 0);
  store.write("", { draft: "ignored" });
  assert.equal(store.size(), 0, "a blank session id is never stored");
});

test("the store is bounded: the least recently written session is evicted first", () => {
  const store = createCodeDeskMemoryStore(2);
  store.write("a", { draft: "a" });
  store.write("b", { draft: "b" });
  store.write("a", { draft: "a2" });
  store.write("c", { draft: "c" });
  assert.equal(store.read("b"), null, "b was the least recently written");
  assert.equal(store.read("a")?.draft, "a2");
  assert.equal(store.read("c")?.draft, "c");
  store.forget("a");
  assert.equal(store.read("a"), null);
  assert.equal(store.size(), 1);
});
