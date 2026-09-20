import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createCovenWikiStore } from "./covenwiki-store.ts";
import schema from "../../docs/covenwiki-manifest.schema.json" with { type: "json" };

const manifest = () => ({
  schemaVersion: "1.0", slug: "demo", title: "Demo", summary: "A wiki",
  source: { kind: "local", fingerprint: null, repoRoot: "/source" },
  generation: { generatedAt: "2026-07-15T00:00:00Z", backend: "stub", status: "stub", wordTarget: [650, 950] },
  navigation: [{ title: "Guide", slug: null, children: [
    { title: "Overview", slug: "overview", children: [] },
    { title: "Details", slug: "details", children: [] },
  ] }],
  pages: ["overview", "details"].map((slug) => ({ slug, title: slug, path: `pages/${slug}.md`, meta: `pages/${slug}.meta.json`, priority: "required", wordCount: 20 })),
  counts: { pages: 2 }, index: "index.md",
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), "covenwiki-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "demo/pages"), { recursive: true });
  const save = (data: unknown) => writeFile(path.join(root, "demo/manifest.json"), JSON.stringify(data));
  await save(manifest());
  return { root, store: createCovenWikiStore(root), save };
}

test("lists and reads shells without opening missing page files", async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual(await store.list(), [manifest()]);
  assert.deepEqual(await store.manifest("demo"), manifest());
  assert.equal(await store.page("demo", ["overview"]), null);
});

test("loads only the selected markdown and metadata; serves index with fallback", async (t) => {
  const { root, store } = await fixture(t);
  const meta = { slug: "overview", title: "Overview", citations: [{ path: "README.md", startLine: 2, endLine: 4 }], coverageNotes: ["Draft"], relatedPages: ["details"] };
  await writeFile(path.join(root, "demo/pages/overview.md"), "# Overview\nHello");
  await writeFile(path.join(root, "demo/pages/overview.meta.json"), JSON.stringify(meta));
  assert.deepEqual(await store.page("demo", ["overview"]), { markdown: "# Overview\nHello", meta });
  assert.match((await store.page("demo", []))!.markdown, /overview/);
  await writeFile(path.join(root, "demo/index.md"), "# Index");
  assert.equal((await store.page("demo", []))!.markdown, "# Index");
  assert.equal(await store.page("demo", ["missing"]), null);
  assert.equal(await store.manifest("missing"), null);
});

test("rejects traversal, encoded separators, absolute and nested route slugs", async (t) => {
  const { store } = await fixture(t);
  for (const slug of ["..", ".", "../demo", "/demo", "a/b", "a\\b", "%2e%2e", "%252e%252e", "a%2fb", "a\0b"]) {
    assert.equal(await store.manifest(slug), null, slug);
    assert.equal(await store.page("demo", [slug]), null, slug);
  }
  assert.equal(await store.page("demo", ["overview", "extra"]), null);
});

test("rejects mismatched slugs and manifest-controlled paths outside the wiki", async (t) => {
  const { store, save } = await fixture(t);
  for (const change of [
    { slug: "other" }, { index: "../secret.md" },
    { pages: [{ ...manifest().pages[0], path: "../../secret.md" }] },
    { pages: [{ ...manifest().pages[0], meta: "/secret.json" }] },
  ]) {
    await save({ ...manifest(), ...change });
    assert.equal(await store.manifest("demo"), null);
  }
});

test("refuses symlinked wiki, manifest, pages directory, page, and metadata", async (t) => {
  const { root, store } = await fixture(t);
  const outside = await mkdtemp(path.join(tmpdir(), "covenwiki-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const meta = { citations: [], coverageNotes: [], relatedPages: [] };
  await mkdir(path.join(outside, "pages"));
  await writeFile(path.join(outside, "manifest.json"), JSON.stringify({ ...manifest(), slug: "escape" }));
  await writeFile(path.join(outside, "pages/overview.md"), "# Secret");
  await writeFile(path.join(outside, "pages/overview.meta.json"), JSON.stringify(meta));
  await symlink(outside, path.join(root, "escape"), "dir");
  assert.equal(await store.manifest("escape"), null);
  for (const file of ["pages/overview.md", "pages/overview.meta.json", "pages", "manifest.json"]) {
    await mkdir(path.join(root, "demo/pages"), { recursive: true });
    await writeFile(path.join(root, "demo/pages/overview.md"), "# Overview");
    await writeFile(path.join(root, "demo/pages/overview.meta.json"), JSON.stringify(meta));
    await writeFile(path.join(outside, "manifest.json"), JSON.stringify(manifest()));
    const target = path.join(root, "demo", file);
    await rm(target, { recursive: true, force: true });
    await symlink(path.join(outside, file), target);
    assert.equal(file === "manifest.json" ? await store.manifest("demo") : await store.page("demo", ["overview"]), null, file);
    await rm(target, { force: true });
  }
});

test("validates schema requirements and rendered optional fields, tolerating additive fields", async (t) => {
  const { store, save } = await fixture(t);
  for (const key of schema.required) {
    const data: Record<string, unknown> = manifest();
    delete data[key];
    await save(data);
    assert.equal(await store.manifest("demo"), null, key);
  }
  for (const change of [
    { schemaVersion: "2.0" }, { summary: {} }, { counts: { pages: "two" } },
    { source: { kind: "local" } },
    { generation: { ...manifest().generation, status: "oops" } },
    { generation: { ...manifest().generation, wordTarget: ["650"] } },
    { navigation: [{ title: "Bad", slug: "missing", children: [] }] },
  ]) {
    await save({ ...manifest(), ...change });
    assert.equal(await store.manifest("demo"), null, JSON.stringify(change));
  }
  await save({ ...manifest(), futureField: { accepted: true } });
  assert.ok(await store.manifest("demo"));
});

test("refuses multiply-linked files and non-regular page files", async (t) => {
  const { root, store } = await fixture(t);
  const page = path.join(root, "demo/pages/overview.md");
  await writeFile(path.join(root, "secret.md"), "Secret");
  await link(path.join(root, "secret.md"), page);
  await writeFile(path.join(root, "demo/pages/overview.meta.json"), JSON.stringify({ citations: [], coverageNotes: [], relatedPages: [] }));
  assert.equal(await store.page("demo", ["overview"]), null);
  await rm(page);
  await mkdir(page);
  assert.equal(await store.page("demo", ["overview"]), null);
});

test("malformed metadata and unsafe citation paths fail closed", async (t) => {
  const { root, store } = await fixture(t);
  await writeFile(path.join(root, "demo/pages/overview.md"), "# Overview");
  for (const meta of [null, { citations: {} }, { slug: "overview", citations: [{ path: "../secret", startLine: 1, endLine: 2 }], coverageNotes: [], relatedPages: [] }]) {
    await writeFile(path.join(root, "demo/pages/overview.meta.json"), JSON.stringify(meta));
    assert.equal(await store.page("demo", ["overview"]), null);
  }
});
