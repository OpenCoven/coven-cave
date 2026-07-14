// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCitationsIndex,
  buildIndexMarkdown,
  buildStubOutline,
  buildStubPage,
  buildWikiManifestData,
  countProseWords,
  extractJsonPayload,
  scaleForInventory,
  slugify,
  validateOutline,
  validatePageDoc,
  PAGE_BUDGETS,
  WORD_TARGETS,
} from "./covenwiki-generate.ts";
import { parseWikiManifest, validateWikiManifest } from "./covenwiki-regen.ts";

const INVENTORY = [
  "README.md",
  "package.json",
  "src/index.ts",
  "src/session.ts",
  "src/util.ts",
  "tests/session.test.ts",
  "docs/getting-started.md",
  "docs/concepts.md",
  "tsconfig.json",
  ".github/workflows/ci.yml",
];

function validOutline(overrides = {}) {
  return {
    title: "Testrepo",
    summary: "A test repository.",
    navigation: [
      { title: "Overview", slug: "overview", children: [] },
      { title: "Source Layout", slug: "source-layout", children: [] },
      { title: "Testing Signals", slug: "testing-signals", children: [] },
    ],
    pages: [
      { slug: "overview", title: "Overview", purpose: "Entry point.", priority: "required", sourcePaths: ["README.md"] },
      { slug: "source-layout", title: "Source Layout", purpose: "Source map.", priority: "recommended", sourcePaths: ["src/index.ts"] },
      { slug: "testing-signals", title: "Testing Signals", purpose: "Tests.", priority: "optional", sourcePaths: ["tests/session.test.ts"] },
    ],
    concepts: [],
    coverageNotes: [],
    ...overrides,
  };
}

// ─── scale + slug helpers ────────────────────────────────────────────────────

test("scaleForInventory follows the IA §3 thresholds", () => {
  assert.equal(scaleForInventory(10), "compact");
  assert.equal(scaleForInventory(24), "compact");
  assert.equal(scaleForInventory(25), "small");
  assert.equal(scaleForInventory(49), "small");
  assert.equal(scaleForInventory(50), "medium");
  assert.equal(scaleForInventory(400), "medium");
  assert.equal(scaleForInventory(401), "large");
});

test("budgets and word targets cover every scale", () => {
  for (const scale of ["compact", "small", "medium", "large"]) {
    assert.equal(PAGE_BUDGETS[scale].length, 2);
    assert.equal(WORD_TARGETS[scale].length, 2);
    assert.ok(PAGE_BUDGETS[scale][0] <= PAGE_BUDGETS[scale][1]);
  }
});

test("slugify produces URL-friendly slugs", () => {
  assert.equal(slugify("Coven Cave"), "coven-cave");
  assert.equal(slugify("My_Repo.Name"), "my-repo-name");
  assert.equal(slugify("---"), "wiki");
});

// ─── outline validation ─────────────────────────────────────────────────────

test("validateOutline accepts a rule-compliant outline", () => {
  const errors = validateOutline(validOutline(), { inventoryPaths: INVENTORY, scale: "compact" });
  assert.deepEqual(errors, []);
});

test("validateOutline requires the overview page", () => {
  const outline = validOutline();
  outline.pages = outline.pages.filter((p) => p.slug !== "overview");
  outline.navigation = outline.navigation.filter((n) => n.slug !== "overview");
  const errors = validateOutline(outline, { inventoryPaths: INVENTORY, scale: "compact" });
  assert.ok(errors.some((e) => e.includes('"overview"')));
});

test("validateOutline rejects folder-of-one group nodes", () => {
  const outline = validOutline({
    navigation: [
      { title: "Overview", slug: "overview", children: [] },
      {
        title: "Group",
        slug: null,
        children: [{ title: "Source Layout", slug: "source-layout", children: [] }],
      },
      { title: "Testing Signals", slug: "testing-signals", children: [] },
    ],
  });
  const errors = validateOutline(outline, { inventoryPaths: INVENTORY, scale: "compact" });
  assert.ok(errors.some((e) => e.includes("folder-of-one")));
});

test("validateOutline rejects nav slugs without pages and unreachable pages", () => {
  const ghost = validOutline();
  ghost.navigation.push({ title: "Ghost", slug: "ghost-page", children: [] });
  let errors = validateOutline(ghost, { inventoryPaths: INVENTORY, scale: "compact" });
  assert.ok(errors.some((e) => e.includes('unknown page slug "ghost-page"')));

  const orphan = validOutline();
  orphan.navigation = orphan.navigation.filter((n) => n.slug !== "testing-signals");
  errors = validateOutline(orphan, { inventoryPaths: INVENTORY, scale: "compact" });
  assert.ok(errors.some((e) => e.includes('"testing-signals" is unreachable')));
});

test("validateOutline rejects invented source paths, bad slugs, duplicates", () => {
  const outline = validOutline();
  outline.pages[1].sourcePaths = ["src/does-not-exist.ts"];
  outline.pages[2].slug = "Testing_Signals";
  outline.navigation[2].slug = "Testing_Signals";
  let errors = validateOutline(outline, { inventoryPaths: INVENTORY, scale: "compact" });
  assert.ok(errors.some((e) => e.includes("not in the file inventory")));
  assert.ok(errors.some((e) => e.includes("lowercase URL-friendly")));

  const dup = validOutline();
  dup.pages[2] = { ...dup.pages[2], slug: "overview" };
  errors = validateOutline(dup, { inventoryPaths: INVENTORY, scale: "compact" });
  assert.ok(errors.some((e) => e.includes("duplicates")));
});

test("validateOutline enforces the scale page budget and hard minimum", () => {
  const tooMany = validOutline();
  for (let i = 0; i < 3; i += 1) {
    const slug = `extra-${i}`;
    tooMany.pages.push({ slug, title: `Extra ${i}`, purpose: "x", priority: "optional", sourcePaths: ["README.md"] });
    tooMany.navigation.push({ title: `Extra ${i}`, slug, children: [] });
  }
  let errors = validateOutline(tooMany, { inventoryPaths: INVENTORY, scale: "compact" });
  assert.ok(errors.some((e) => e.includes("exceeds the compact-scale budget")));

  const tooFew = validOutline();
  tooFew.pages = tooFew.pages.slice(0, 1);
  tooFew.navigation = tooFew.navigation.slice(0, 1);
  errors = validateOutline(tooFew, { inventoryPaths: INVENTORY, scale: "compact" });
  assert.ok(errors.some((e) => e.includes("hard minimum")));

  // Tiny repos (README-only) may legitimately have one page.
  errors = validateOutline(
    validOutline({
      navigation: [{ title: "Overview", slug: "overview", children: [] }],
      pages: [{ slug: "overview", title: "Overview", purpose: "Entry.", priority: "required", sourcePaths: ["README.md"] }],
    }),
    { inventoryPaths: ["README.md"], scale: "compact" },
  );
  assert.deepEqual(errors, []);
});

// ─── page validation ─────────────────────────────────────────────────────────

function validPage(overrides = {}) {
  return {
    slug: "overview",
    title: "Overview",
    markdown: "# Overview\n\nSome prose about the project.\n\n## Relevant source files\n\n- `README.md`\n",
    citations: [{ path: "README.md", startLine: null, endLine: null }],
    coverageNotes: [],
    relatedPages: ["source-layout"],
    ...overrides,
  };
}

const PAGE_OPTS = { inventoryPaths: INVENTORY, pageSlugs: ["overview", "source-layout"], minCitations: 1 };

test("validatePageDoc accepts a valid page", () => {
  assert.deepEqual(validatePageDoc(validPage(), PAGE_OPTS), []);
});

test("validatePageDoc enforces H1, citations, and related pages", () => {
  let errors = validatePageDoc(validPage({ markdown: "no heading here" }), PAGE_OPTS);
  assert.ok(errors.some((e) => e.includes("H1")));

  errors = validatePageDoc(validPage({ citations: [] }), PAGE_OPTS);
  assert.ok(errors.some((e) => e.includes("at least 1 citation")));

  errors = validatePageDoc(validPage({ citations: [{ path: "/etc/passwd", startLine: null, endLine: null }] }), PAGE_OPTS);
  assert.ok(errors.some((e) => e.includes("repository-relative")));

  errors = validatePageDoc(validPage({ citations: [{ path: "nope.md", startLine: null, endLine: null }] }), PAGE_OPTS);
  assert.ok(errors.some((e) => e.includes("not in the file inventory")));

  errors = validatePageDoc(validPage({ citations: [{ path: "README.md", startLine: 0, endLine: null }] }), PAGE_OPTS);
  assert.ok(errors.some((e) => e.includes("positive integer or null")));

  errors = validatePageDoc(validPage({ relatedPages: ["ghost"] }), PAGE_OPTS);
  assert.ok(errors.some((e) => e.includes('unknown page "ghost"')));

  errors = validatePageDoc(validPage({ relatedPages: ["overview"] }), PAGE_OPTS);
  assert.ok(errors.some((e) => e.includes("itself")));
});

// ─── word counting ───────────────────────────────────────────────────────────

test("countProseWords counts only prose", () => {
  const markdown = [
    "# Title",
    "",
    "One two three four five.",
    "",
    "```js",
    "const ignored = 'entirely';",
    "```",
    "",
    "| a | table |",
    "| - | ----- |",
    "",
    "Sources: README.md",
    "",
    "Six seven [eight](http://x) `nine` ten.",
  ].join("\n");
  // "nine" is inline code (stripped); link text "eight" counts.
  assert.equal(countProseWords(markdown), 9);
});

// ─── stub backend ────────────────────────────────────────────────────────────

test("buildStubOutline passes its own validator and cites only inventory", () => {
  const outline = buildStubOutline({ repoName: "testrepo", inventoryPaths: INVENTORY });
  const errors = validateOutline(outline, { inventoryPaths: INVENTORY, scale: scaleForInventory(INVENTORY.length) });
  assert.deepEqual(errors, []);
  assert.ok(outline.pages.length >= 3);
  assert.equal(outline.pages[0].slug, "overview");
});

test("buildStubOutline handles a README-only repo", () => {
  const outline = buildStubOutline({ repoName: "tiny", inventoryPaths: ["README.md"] });
  const errors = validateOutline(outline, { inventoryPaths: ["README.md"], scale: "compact" });
  assert.deepEqual(errors, []);
  assert.equal(outline.pages.length, 1);
});

test("buildStubPage passes page validation and cites the outline sources", () => {
  const outline = buildStubOutline({ repoName: "testrepo", inventoryPaths: INVENTORY });
  for (const entry of outline.pages) {
    const page = buildStubPage(entry, outline);
    const errors = validatePageDoc(page, {
      inventoryPaths: INVENTORY,
      pageSlugs: outline.pages.map((p) => p.slug),
      minCitations: 1,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(page.citations.map((c) => c.path), entry.sourcePaths);
  }
});

// ─── assembly ────────────────────────────────────────────────────────────────

function assembled() {
  const outline = buildStubOutline({ repoName: "testrepo", inventoryPaths: INVENTORY });
  const pages = outline.pages.map((p) => buildStubPage(p, outline));
  const manifest = buildWikiManifestData({
    slug: "testrepo",
    outline,
    pages,
    repoRoot: "/tmp/testrepo",
    fingerprint: "0123456789abcdef",
    fileCount: INVENTORY.length,
    backend: "stub",
    generatedAt: "2026-07-14T00:00:00.000Z",
    scale: "compact",
  });
  return { outline, pages, manifest };
}

test("assembled manifest satisfies the Phase 3 regen-hook validator", () => {
  const { manifest } = assembled();
  assert.deepEqual(validateWikiManifest(manifest), []);
  const parsed = parseWikiManifest(JSON.stringify(manifest));
  assert.equal(parsed.slug, "testrepo");
  assert.equal(parsed.source.fingerprint, "0123456789abcdef");
});

test("manifest counts, paths, and word targets are consistent", () => {
  const { manifest } = assembled();
  assert.equal(manifest.schemaVersion, "1.0");
  assert.equal(manifest.counts.pages, manifest.pages.length);
  assert.equal(
    manifest.counts.required + manifest.counts.recommended + manifest.counts.optional,
    manifest.pages.length,
  );
  assert.deepEqual(manifest.generation.wordTarget, WORD_TARGETS.compact);
  assert.equal(manifest.generation.status, "stub");
  for (const page of manifest.pages) {
    assert.equal(page.path, `pages/${page.slug}.md`);
    assert.equal(page.meta, `pages/${page.slug}.meta.json`);
    assert.equal(typeof page.wordCount, "number");
  }
});

test("cli backend marks generation complete and records models", () => {
  const { outline, pages } = assembled();
  const manifest = buildWikiManifestData({
    slug: "testrepo",
    outline,
    pages,
    repoRoot: "/tmp/testrepo",
    fingerprint: "0123456789abcdef",
    fileCount: INVENTORY.length,
    backend: "cli",
    generatedAt: "2026-07-14T00:00:00.000Z",
    scale: "compact",
    models: { outline: "fake-model", page: "fake-model" },
  });
  assert.equal(manifest.generation.status, "complete");
  assert.equal(manifest.generation.models.outline, "fake-model");
});

test("buildCitationsIndex builds the source⇄page reverse lookup", () => {
  const { pages, manifest } = assembled();
  const index = buildCitationsIndex(pages, manifest.generation.generatedAt);
  assert.equal(index.schemaVersion, "1.0");
  assert.deepEqual(index.bySource["README.md"], ["overview"]);
  for (const [source, slugs] of Object.entries(index.bySource)) {
    for (const slug of slugs) {
      assert.ok(index.byPage[slug].some((c) => c.path === source), `${slug} must cite ${source}`);
    }
  }
  for (const [slug, citations] of Object.entries(index.byPage)) {
    for (const citation of citations) {
      assert.ok(index.bySource[citation.path].includes(slug));
    }
  }
});

test("buildIndexMarkdown renders the nav tree with group headers", () => {
  const { manifest } = assembled();
  const md = buildIndexMarkdown(manifest);
  assert.ok(md.startsWith(`# ${manifest.title}`));
  assert.ok(md.includes("- [Overview](pages/overview.md)"));

  const grouped = {
    ...manifest,
    navigation: [
      { title: "Overview", slug: "overview", children: [] },
      {
        title: "Guides",
        slug: null,
        children: [
          { title: "A", slug: "a", children: [] },
          { title: "B", slug: "b", children: [] },
        ],
      },
    ],
  };
  const groupedMd = buildIndexMarkdown(grouped);
  assert.ok(groupedMd.includes("- Guides\n  - [A](pages/a.md)"));
});

// ─── model output recovery ───────────────────────────────────────────────────

test("extractJsonPayload handles bare, fenced, and wrapped JSON", () => {
  assert.deepEqual(extractJsonPayload('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJsonPayload('Here you go:\n```json\n{"a":1}\n```\nDone.'), { a: 1 });
  assert.deepEqual(extractJsonPayload('Sure!\n\n{"a":{"b":2}}\n\nAnything else?'), { a: { b: 2 } });
  assert.throws(() => extractJsonPayload("no json here"), /parseable JSON/);
});
