// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildManifest,
  diffManifests,
  nextState,
  pageIdForSource,
  parseState,
  planRegeneration,
  serializeState,
  summarizePlan,
} from "./covenwiki-regen.ts";

const ROOTS = ["docs"];

function manifest(entries, generatedAt = "2026-07-12T00:00:00.000Z") {
  return buildManifest(
    Object.entries(entries).map(([path, hash]) => ({ path, hash })),
    generatedAt,
  );
}

// S1 — scan/manifest

test("buildManifest sorts entries by path", () => {
  const m = manifest({ "docs/z.md": "1", "docs/a.md": "2" });
  assert.deepEqual(Object.keys(m.entries), ["docs/a.md", "docs/z.md"]);
});

test("buildManifest rejects duplicate and empty paths", () => {
  assert.throws(
    () =>
      buildManifest(
        [
          { path: "docs/a.md", hash: "1" },
          { path: "docs/a.md", hash: "2" },
        ],
        "t",
      ),
    /duplicate/,
  );
  assert.throws(() => buildManifest([{ path: "", hash: "1" }], "t"), /empty path/);
});

// S2 — diff

test("diffManifests against null previous marks everything added", () => {
  const diff = diffManifests(null, manifest({ "docs/a.md": "1", "docs/b.md": "2" }));
  assert.deepEqual(diff.added, ["docs/a.md", "docs/b.md"]);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
  assert.equal(diff.dirty, true);
});

test("diffManifests detects added, removed, changed, unchanged", () => {
  const prev = manifest({ "docs/keep.md": "1", "docs/edit.md": "1", "docs/gone.md": "1" });
  const next = manifest({ "docs/keep.md": "1", "docs/edit.md": "2", "docs/new.md": "1" });
  const diff = diffManifests(prev, next);
  assert.deepEqual(diff.added, ["docs/new.md"]);
  assert.deepEqual(diff.changed, ["docs/edit.md"]);
  assert.deepEqual(diff.removed, ["docs/gone.md"]);
  assert.equal(diff.unchangedCount, 1);
  assert.equal(diff.dirty, true);
});

test("diffManifests reports clean when nothing moved", () => {
  const m = manifest({ "docs/a.md": "1" });
  const diff = diffManifests(m, manifest({ "docs/a.md": "1" }, "2026-07-12T01:00:00.000Z"));
  assert.equal(diff.dirty, false);
  assert.equal(diff.unchangedCount, 1);
});

// page id mapping

test("pageIdForSource strips source root and markdown extension", () => {
  assert.equal(pageIdForSource("docs/guides/setup.md", ROOTS), "guides/setup");
  assert.equal(pageIdForSource("docs/index.mdx", ROOTS), "index");
});

test("pageIdForSource prefers the longest matching root", () => {
  assert.equal(pageIdForSource("docs/wiki/a.md", ["docs", "docs/wiki"]), "a");
});

test("pageIdForSource returns null for non-markdown sources", () => {
  assert.equal(pageIdForSource("docs/assets/logo.png", ROOTS), null);
});

test("pageIdForSource handles a source root that is itself a file", () => {
  assert.equal(pageIdForSource("README.md", ["README.md"]), "README");
});

// S3 — plan

test("planRegeneration is empty when the diff is clean", () => {
  const plan = planRegeneration(
    { added: [], removed: [], changed: [], unchangedCount: 3, dirty: false },
    { sourceRoots: ROOTS },
  );
  assert.deepEqual(plan, { dirty: false, actions: [] });
});

test("planRegeneration maps added/changed/removed sources to page actions plus index", () => {
  const plan = planRegeneration(
    {
      added: ["docs/new.md"],
      changed: ["docs/edit.md"],
      removed: ["docs/gone.md"],
      unchangedCount: 0,
      dirty: true,
    },
    { sourceRoots: ROOTS },
  );
  assert.deepEqual(
    plan.actions.map((a) => [a.kind, a.page]),
    [
      ["regenerate-page", "edit"],
      ["regenerate-page", "new"],
      ["remove-page", "gone"],
      ["rebuild-index", null],
    ],
  );
});

test("planRegeneration treats a removed source of a still-live page as regen, not removal", () => {
  const plan = planRegeneration(
    { added: [], changed: ["docs/page.md"], removed: ["docs/page.mdx"], unchangedCount: 0, dirty: true },
    { sourceRoots: ROOTS },
  );
  const kinds = plan.actions.map((a) => a.kind);
  assert.ok(!kinds.includes("remove-page"));
  assert.deepEqual(plan.actions[0].sources, ["docs/page.md", "docs/page.mdx"]);
});

test("planRegeneration collapses to full-rebuild when a shared path changes", () => {
  const plan = planRegeneration(
    { added: [], changed: ["templates/wiki.hbs", "docs/a.md"], removed: [], unchangedCount: 0, dirty: true },
    { sourceRoots: ROOTS, fullRebuildPaths: ["templates/"] },
  );
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].kind, "full-rebuild");
  assert.deepEqual(plan.actions[0].sources, ["templates/wiki.hbs"]);
});

test("planRegeneration routes non-page sources to the index rebuild", () => {
  const plan = planRegeneration(
    { added: ["docs/assets/logo.png"], changed: [], removed: [], unchangedCount: 0, dirty: true },
    { sourceRoots: ROOTS },
  );
  assert.deepEqual(
    plan.actions.map((a) => a.kind),
    ["rebuild-index"],
  );
});

// S4 — state + report

test("state round-trips through serialize/parse", () => {
  const state = nextState(manifest({ "docs/a.md": "1" }));
  const restored = parseState(serializeState(state));
  assert.deepEqual(restored, state);
});

test("parseState rejects garbage and wrong versions", () => {
  assert.throws(() => parseState("not json"), /not valid JSON/);
  assert.throws(() => parseState(JSON.stringify({ version: 2, manifest: { entries: {} } })), /unsupported/);
  assert.throws(() => parseState(JSON.stringify({ version: 1 })), /unsupported/);
});

test("summarizePlan reports counts and actions", () => {
  const diff = {
    added: ["docs/new.md"],
    changed: [],
    removed: [],
    unchangedCount: 2,
    dirty: true,
  };
  const plan = planRegeneration(diff, { sourceRoots: ROOTS });
  const lines = summarizePlan(diff, plan);
  assert.equal(lines[0], "sources: +1 ~0 -0 =2");
  assert.ok(lines.some((l) => l.startsWith("regenerate-page new")));
});

test("summarizePlan reports a clean tree", () => {
  const diff = { added: [], changed: [], removed: [], unchangedCount: 5, dirty: false };
  const lines = summarizePlan(diff, { dirty: false, actions: [] });
  assert.deepEqual(lines, ["sources: +0 ~0 -0 =5", "wiki up to date — no regeneration needed"]);
});
