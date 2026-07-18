// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildManifest,
  buildWikiStatus,
  computeSourceFingerprint,
  diffManifests,
  formatWikiStatus,
  isStale,
  nextState,
  pageIdForSource,
  parseCitationsIndex,
  parseState,
  parseWikiManifest,
  planRegeneration,
  serializeState,
  summarizePlan,
  validateWikiManifest,
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

// S3 — plan, citations reverse-lookup mode (_citations.json bySource)

const BY_SOURCE = {
  "README.md": ["overview"],
  "src/session.ts": ["overview", "session-model"],
  "docs/guide.md": ["guide"],
};

test("citations mode: a changed source regenerates every page citing it", () => {
  const plan = planRegeneration(
    { added: [], changed: ["src/session.ts"], removed: [], unchangedCount: 2, dirty: true },
    { sourceRoots: ROOTS, citationsBySource: BY_SOURCE },
  );
  assert.deepEqual(
    plan.actions.map((a) => [a.kind, a.page]),
    [
      ["regenerate-page", "overview"],
      ["regenerate-page", "session-model"],
      ["rebuild-index", null],
    ],
  );
  // The point of the mode: page ids are outline slugs, never path stems.
  assert.ok(!plan.actions.some((a) => a.page === "session"));
});

test("citations mode: non-markdown cited sources map to pages (stemming never could)", () => {
  const plan = planRegeneration(
    { added: [], changed: ["src/session.ts"], removed: [], unchangedCount: 0, dirty: true },
    { sourceRoots: ROOTS, citationsBySource: { "src/session.ts": ["api-surface"] } },
  );
  assert.deepEqual(plan.actions[0], {
    kind: "regenerate-page",
    page: "api-surface",
    sources: ["src/session.ts"],
    reason: "changed",
  });
});

test("citations mode: removed sources regenerate citing pages, never remove-page", () => {
  const plan = planRegeneration(
    { added: [], changed: [], removed: ["docs/guide.md"], unchangedCount: 2, dirty: true },
    { sourceRoots: ROOTS, citationsBySource: BY_SOURCE },
  );
  assert.deepEqual(
    plan.actions.map((a) => [a.kind, a.page, a.reason]),
    [
      ["regenerate-page", "guide", "source removed"],
      ["rebuild-index", null, "cited sources changed"],
    ],
  );
});

test("citations mode: uncited changes are index-only and flag an outline refresh", () => {
  const plan = planRegeneration(
    { added: ["docs/brand-new.md"], changed: ["assets/logo.png"], removed: [], unchangedCount: 3, dirty: true },
    { sourceRoots: ROOTS, citationsBySource: BY_SOURCE },
  );
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].kind, "rebuild-index");
  assert.match(plan.actions[0].reason, /outline refresh/);
});

test("citations mode: multiple triggers for one page merge into one action", () => {
  const plan = planRegeneration(
    { added: [], changed: ["README.md"], removed: ["src/session.ts"], unchangedCount: 0, dirty: true },
    { sourceRoots: ROOTS, citationsBySource: BY_SOURCE },
  );
  const overview = plan.actions.find((a) => a.page === "overview");
  assert.deepEqual(overview.sources, ["README.md", "src/session.ts"]);
  assert.equal(overview.reason, "changed, source removed");
  assert.equal(plan.actions.filter((a) => a.page === "overview").length, 1);
});

test("citations mode: fullRebuildPaths still wins over the reverse lookup", () => {
  const plan = planRegeneration(
    { added: [], changed: ["templates/wiki.hbs", "README.md"], removed: [], unchangedCount: 0, dirty: true },
    { sourceRoots: ROOTS, fullRebuildPaths: ["templates/"], citationsBySource: BY_SOURCE },
  );
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].kind, "full-rebuild");
});

test("parseCitationsIndex accepts the generated shape and strips it to bySource", () => {
  const raw = JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-07-14T00:00:00.000Z",
    bySource: { "README.md": ["overview"] },
    byPage: { overview: [{ path: "README.md", startLine: null, endLine: null }] },
  });
  assert.deepEqual(parseCitationsIndex(raw), { "README.md": ["overview"] });
});

test("parseCitationsIndex fails closed on malformed input", () => {
  assert.throws(() => parseCitationsIndex("not json"), /not valid JSON/);
  assert.throws(() => parseCitationsIndex('{"schemaVersion":"2.0","bySource":{}}'), /schemaVersion/);
  assert.throws(() => parseCitationsIndex('{"schemaVersion":"1.0"}'), /bySource/);
  assert.throws(
    () => parseCitationsIndex('{"schemaVersion":"1.0","bySource":{"a.md":"overview"}}'),
    /array of page slugs/,
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

// ─── plan-semantics layer (S1–S4) ───

function wikiManifest(overrides = {}) {
  return {
    schemaVersion: "1.0",
    slug: "testrepo",
    title: "Test Repo",
    source: { kind: "local", repoRoot: "/tmp/testrepo", fingerprint: "30bbd660aaaaaaaa", fileCount: 2 },
    generation: { generatedAt: "2026-07-03T12:09:52Z", backend: "stub", status: "stub" },
    navigation: [{ title: "Overview", slug: "overview", children: [] }],
    pages: [
      {
        slug: "overview",
        title: "Overview",
        path: "pages/overview.md",
        meta: "pages/overview.meta.json",
        priority: "required",
      },
    ],
    counts: { pages: 1 },
    ...overrides,
  };
}

// fingerprint

test("computeSourceFingerprint emits 16 hex chars, independent of entry order", () => {
  const a = { path: "src/a.ts", size: 10, mtimeMs: 1000 };
  const b = { path: "src/b.ts", size: 20, mtimeMs: 2000 };
  const fp = computeSourceFingerprint([a, b]);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(computeSourceFingerprint([b, a]), fp);
});

test("computeSourceFingerprint flips on path, size, or mtime changes", () => {
  const base = [{ path: "a.md", size: 5, mtimeMs: 100 }];
  const fp = computeSourceFingerprint(base);
  assert.notEqual(computeSourceFingerprint([{ ...base[0], path: "b.md" }]), fp);
  assert.notEqual(computeSourceFingerprint([{ ...base[0], size: 6 }]), fp);
  assert.notEqual(computeSourceFingerprint([{ ...base[0], mtimeMs: 101 }]), fp);
  assert.equal(computeSourceFingerprint([{ ...base[0] }]), fp);
});

test("computeSourceFingerprint floors fractional mtimes", () => {
  const fp = computeSourceFingerprint([{ path: "a.md", size: 5, mtimeMs: 100.4 }]);
  assert.equal(computeSourceFingerprint([{ path: "a.md", size: 5, mtimeMs: 100.9 }]), fp);
});

// S1 — isStale

test("isStale is fresh when fingerprints match", () => {
  const m = wikiManifest();
  assert.equal(isStale(m, "30bbd660aaaaaaaa").freshness, "fresh");
});

test("isStale is stale when fingerprints differ", () => {
  const m = wikiManifest();
  assert.equal(isStale(m, "5914649ebbbbbbbb").freshness, "stale");
});

test("isStale is unknown for non-local sources (github is Phase 5)", () => {
  const m = wikiManifest({ source: { kind: "github", fingerprint: "30bbd660aaaaaaaa" } });
  const result = isStale(m, "30bbd660aaaaaaaa");
  assert.equal(result.freshness, "unknown");
  assert.match(result.reason, /github|local/);
});

test("isStale is unknown when the manifest or live fingerprint is missing", () => {
  assert.equal(isStale(wikiManifest({ source: { kind: "local", fingerprint: null } }), "abc").freshness, "unknown");
  assert.equal(isStale(wikiManifest(), null).freshness, "unknown");
});

// S2 — status report

test("buildWikiStatus reports both fingerprints and generation metadata", () => {
  const status = buildWikiStatus(wikiManifest(), "5914649ebbbbbbbb", 3);
  assert.equal(status.slug, "testrepo");
  assert.equal(status.freshness, "stale");
  assert.deepEqual(status.fingerprint, { manifest: "30bbd660aaaaaaaa", live: "5914649ebbbbbbbb" });
  assert.deepEqual(status.fileCount, { manifest: 2, live: 3 });
  assert.equal(status.generatedAt, "2026-07-03T12:09:52Z");
  assert.equal(status.backend, "stub");
  assert.equal(status.pages, 1);
});

test("formatWikiStatus renders freshness, fingerprints, and generatedAt", () => {
  const lines = formatWikiStatus(buildWikiStatus(wikiManifest(), "30bbd660aaaaaaaa", 2));
  assert.match(lines[0], /^testrepo: fresh/);
  assert.match(lines[1], /manifest=30bbd660aaaaaaaa live=30bbd660aaaaaaaa/);
  assert.match(lines[2], /generatedAt: 2026-07-03T12:09:52Z/);
});

// S4 — manifest validator

test("validateWikiManifest accepts a contract-shaped manifest", () => {
  assert.deepEqual(validateWikiManifest(wikiManifest()), []);
});

test("validateWikiManifest accepts null-slug folder nav nodes", () => {
  const m = wikiManifest({
    navigation: [{ title: "Guides", slug: null, children: [{ title: "Setup", slug: "setup", children: [] }] }],
  });
  assert.deepEqual(validateWikiManifest(m), []);
});

test("validateWikiManifest lists every missing required field", () => {
  const errors = validateWikiManifest({});
  for (const field of ["schemaVersion", "slug", "title", "source", "generation", "navigation", "pages", "counts"]) {
    assert.ok(errors.some((e) => e.includes(field)), `expected an error mentioning ${field}`);
  }
});

test("validateWikiManifest rejects malformed nav and page entries", () => {
  const badNav = wikiManifest({ navigation: [{ title: "", slug: 3, children: "nope" }] });
  const navErrors = validateWikiManifest(badNav);
  assert.ok(navErrors.some((e) => e.includes("navigation[0].title")));
  assert.ok(navErrors.some((e) => e.includes("navigation[0].slug")));
  assert.ok(navErrors.some((e) => e.includes("navigation[0].children")));

  const badPage = wikiManifest({ pages: [{ slug: "x", title: "X", path: "", meta: "m", priority: "urgent" }] });
  const pageErrors = validateWikiManifest(badPage);
  assert.ok(pageErrors.some((e) => e.includes("pages[0].path")));
  assert.ok(pageErrors.some((e) => e.includes("pages[0].priority")));

  assert.deepEqual(validateWikiManifest("nope"), ["manifest must be a JSON object"]);
});

test("parseWikiManifest round-trips valid JSON and throws otherwise", () => {
  const m = wikiManifest();
  assert.deepEqual(parseWikiManifest(JSON.stringify(m)), m);
  assert.throws(() => parseWikiManifest("not json"), /not valid JSON/);
  assert.throws(() => parseWikiManifest(JSON.stringify({ slug: "x" })), /invalid/);
});
