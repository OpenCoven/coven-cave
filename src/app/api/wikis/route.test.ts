import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GET as list } from "./route.ts";
import { GET as manifest } from "./[repo]/route.ts";
import { GET as page } from "./[repo]/page/[[...slug]]/route.ts";

test("read APIs return manifests without pages, lazy content, and private 404s", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "covenwiki-api-"));
  const previous = process.env.COVENWIKI_WIKIS_DIR;
  process.env.COVENWIKI_WIKIS_DIR = root;
  try {
    await mkdir(path.join(root, "demo/pages"), { recursive: true });
    await writeFile(path.join(root, "demo/manifest.json"), JSON.stringify({
      schemaVersion: "1.0", slug: "demo", title: "Demo",
      source: { kind: "local", fingerprint: null },
      generation: { generatedAt: "2026-07-15", backend: "stub", status: "stub" },
      navigation: [{ title: "Overview", slug: "overview", children: [] }],
      pages: [{ slug: "overview", title: "Overview", path: "pages/overview.md", meta: "pages/overview.meta.json", priority: "required" }], counts: { pages: 1 },
    }));
    const req = new Request("http://localhost/api/wikis");
    const listed = await list();
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).wikis.length, 1);
    assert.match(listed.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await manifest(req, { params: Promise.resolve({ repo: "demo" }) })).status, 200);
    for (const repo of ["missing", "..", "%2fetc", "demo/../demo"]) {
      const response = await manifest(req, { params: Promise.resolve({ repo }) });
      assert.equal(response.status, 404);
      assert.ok(!(await response.text()).includes(root));
    }
    assert.equal((await page(req, { params: Promise.resolve({ repo: "demo", slug: ["overview"] }) })).status, 404);
    await writeFile(path.join(root, "demo/pages/overview.md"), "# Overview");
    await writeFile(path.join(root, "demo/pages/overview.meta.json"), JSON.stringify({ citations: [], coverageNotes: [], relatedPages: [] }));
    const response = await page(req, { params: Promise.resolve({ repo: "demo", slug: ["overview"] }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).page.markdown, "# Overview");
    assert.equal((await page(req, { params: Promise.resolve({ repo: "demo" }) })).status, 200);
    assert.equal((await page(req, { params: Promise.resolve({ repo: "demo", slug: ["overview", "extra"] }) })).status, 404);
  } finally {
    if (previous === undefined) delete process.env.COVENWIKI_WIKIS_DIR;
    else process.env.COVENWIKI_WIKIS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
