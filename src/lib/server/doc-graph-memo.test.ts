// @ts-nocheck
// #5682: an unchanged Grimoire corpus reuses its last graph.
import assert from "node:assert/strict";
import test from "node:test";
import { createDocGraphMemo } from "./doc-graph-memo.ts";

function corpus() {
  return {
    docs: [
      { ref: { kind: "knowledge", id: "k1", collection: "notes" }, title: "Plan", markdown: "see [[2026-09-01]]", tags: ["a"] },
      { ref: { kind: "memory", path: "/m/one.md" }, title: "one", markdown: "memory body" },
      { ref: { kind: "journal", date: "2026-09-01" }, title: "2026-09-01", markdown: "reflection" },
    ],
    index: {
      knowledge: [{ id: "k1", collection: "notes", title: "Plan" }],
      memory: [{ path: "/m/one.md" }, { path: "/m/unscanned.md" }],
      journal: [{ date: "2026-09-01" }],
    },
  };
}

function counting() {
  let builds = 0;
  const memo = createDocGraphMemo(() => ({ nodes: [{ id: `n${++builds}` }], edges: [] }), 2);
  return { memo, builds: () => builds };
}

test("equal inputs rebuilt as fresh objects reuse the graph", () => {
  const { memo, builds } = counting();
  const a = corpus();
  const first = memo.build("", a.docs, a.index);
  const b = corpus();
  assert.equal(memo.build("", b.docs, b.index), first);
  assert.equal(builds(), 1);
});

const changes = {
  "a doc body": (c) => { c.docs[1].markdown = "edited"; },
  "a doc title": (c) => { c.docs[0].title = "Renamed"; },
  "a tag": (c) => { c.docs[0].tags = ["a", "b"]; },
  "a ref": (c) => { c.docs[1].ref = { kind: "memory", path: "/m/two.md" }; },
  "a knowledge collection": (c) => { c.docs[0].ref = { kind: "knowledge", id: "k1" }; },
  "an added doc": (c) => { c.docs.push({ ref: { kind: "journal", date: "2026-09-02" }, title: "2026-09-02", markdown: "" }); },
  "an unscanned file in the index": (c) => { c.index.memory.push({ path: "/m/new.md" }); },
  "a knowledge title in the index": (c) => { c.index.knowledge[0].title = "Other"; },
  "a journal day in the index": (c) => { c.index.journal.push({ date: "2026-09-02" }); },
};
for (const [label, change] of Object.entries(changes)) {
  test(`${label} rebuilds`, () => {
    const { memo, builds } = counting();
    const a = corpus();
    const first = memo.build("", a.docs, a.index);
    const b = corpus();
    change(b);
    assert.notEqual(memo.build("", b.docs, b.index), first);
    assert.equal(builds(), 2);
  });
}

test("each scope keeps its own graph, bounded to the newest scopes", () => {
  const { memo, builds } = counting();
  const c = corpus();
  const all = memo.build("", c.docs, c.index);
  const scoped = memo.build("nova", c.docs, c.index);
  assert.notEqual(all, scoped);
  assert.equal(memo.build("", c.docs, c.index), all, "switching back reuses the unscoped graph");
  assert.equal(builds(), 2);
  memo.build("sage", c.docs, c.index); // evicts "nova", the least recently used
  assert.equal(memo.build("", c.docs, c.index), all);
  memo.build("nova", c.docs, c.index);
  assert.equal(builds(), 4, "an evicted scope rebuilds");
});
