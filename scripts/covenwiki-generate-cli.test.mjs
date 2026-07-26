// End-to-end coverage for the CovenWiki Phase 1 generator CLI
// (scripts/covenwiki-generate.ts): stub generation produces the full wiki
// contract, the emitted fingerprint reads as "fresh" through the Phase 3
// regen hook (the parity gate), the regen regenerate round-trip works with
// this generator, the cli backend drives the two skills through a fake model
// command, and rule-violating model output fails closed with no wiki written.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "covenwiki-generate-cli-"));
const repoDir = path.join(dir, "repo");
const wikisDir = path.join(dir, "wikis");
const wikiDir = path.join(wikisDir, "testrepo");
const fakeModelScript = path.join(dir, "fake-model.mjs");
const repoRootUrl = new URL("..", import.meta.url);

function writeRepo() {
  mkdirSync(path.join(repoDir, "src"), { recursive: true });
  mkdirSync(path.join(repoDir, "tests"), { recursive: true });
  mkdirSync(path.join(repoDir, "docs"), { recursive: true });
  writeFileSync(path.join(repoDir, "README.md"), "# testrepo\n\nA fixture repository for covenwiki tests.\n");
  writeFileSync(path.join(repoDir, "package.json"), '{ "name": "testrepo", "version": "1.0.0" }\n');
  writeFileSync(path.join(repoDir, "src", "main.ts"), "export const main = () => 1;\n");
  writeFileSync(path.join(repoDir, "src", "util.ts"), "export const util = () => 2;\n");
  writeFileSync(path.join(repoDir, "tests", "main.test.ts"), "// test fixture\n");
  writeFileSync(path.join(repoDir, "docs", "guide.md"), "# Guide\n");
}

// Fake model: reads the composed skill prompt on stdin, parses the input
// payload out of the trailing ```json block, and answers the outline or page
// contract. FAKE_MODEL_MODE=bad-outline emits a folder-of-one + invented path.
writeFileSync(
  fakeModelScript,
  `const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const prompt = Buffer.concat(chunks).toString("utf8");
  const fences = [...prompt.matchAll(/\\u0060\\u0060\\u0060json\\n([\\s\\S]*?)\\n\\u0060\\u0060\\u0060/g)];
  const payload = JSON.parse(fences[fences.length - 1][1]);
  const mode = process.env.FAKE_MODEL_MODE ?? "ok";
  if (prompt.includes("## Repository input")) {
    if (mode === "bad-outline") {
      console.log(JSON.stringify({
        title: payload.repoName,
        summary: "Bad outline.",
        navigation: [
          { title: "Overview", slug: "overview", children: [] },
          { title: "Lonely Group", slug: null, children: [{ title: "Only", slug: "only-child", children: [] }] },
        ],
        pages: [
          { slug: "overview", title: "Overview", purpose: "Entry.", priority: "required", sourcePaths: ["README.md"] },
          { slug: "only-child", title: "Only", purpose: "x.", priority: "optional", sourcePaths: ["invented/path.ts"] },
        ],
        concepts: [],
        coverageNotes: [],
      }));
      return;
    }
    const src = payload.inventoryPaths.filter((p) => p.startsWith("src/"));
    console.log("Sure — here is the outline:\\n\\u0060\\u0060\\u0060json\\n" + JSON.stringify({
      title: payload.repoName,
      summary: "A fixture repository documented by the fake model.",
      navigation: [
        { title: "Overview", slug: "overview", children: [] },
        { title: "Source Layout", slug: "source-layout", children: [] },
        { title: "Documentation Guide", slug: "documentation-guide", children: [] },
      ],
      pages: [
        { slug: "overview", title: "Overview", purpose: "Entry point.", priority: "required", sourcePaths: ["README.md", "package.json"] },
        { slug: "source-layout", title: "Source Layout", purpose: "Source map.", priority: "recommended", sourcePaths: src },
        { slug: "documentation-guide", title: "Documentation Guide", purpose: "Docs tour.", priority: "optional", sourcePaths: ["docs/guide.md"] },
      ],
      concepts: ["fixture"],
      coverageNotes: [],
    }) + "\\n\\u0060\\u0060\\u0060\\nDone!");
    return;
  }
  const evidence = payload.evidence.map((e) => e.path);
  const others = payload.outline.pages.map((p) => p.slug).filter((s) => s !== payload.page.slug);
  console.log(JSON.stringify({
    slug: payload.page.slug,
    title: payload.page.title,
    markdown: "# " + payload.page.title + "\\n\\nFake-model prose grounded in the provided excerpts.\\n\\n## Relevant source files\\n\\n" + evidence.map((p) => "- \\u0060" + p + "\\u0060").join("\\n") + "\\n",
    citations: evidence.map((p) => ({ path: p, startLine: 1, endLine: 1 })),
    coverageNotes: [],
    relatedPages: others.slice(0, 2),
  }));
});
`,
);

function runGenerate(args, env = {}) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/covenwiki-generate.ts", "generate", ...args],
    { cwd: repoRootUrl, encoding: "utf8", env: { ...process.env, ...env } },
  );
}

function runRegen(args) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/covenwiki-regen.ts", ...args, "--wikis-dir", wikisDir],
    { cwd: repoRootUrl, encoding: "utf8" },
  );
}

function readJson(...segments) {
  return JSON.parse(readFileSync(path.join(...segments), "utf8"));
}

/** Parse the last top-level JSON object in mixed stdout (regen inherits the generator's stdout). */
function tailJson(text) {
  const idx = text.lastIndexOf("\n{");
  return JSON.parse(text.slice(idx === -1 ? 0 : idx + 1));
}

try {
  writeRepo();

  // ── stub generation writes the full wiki contract ──
  let result = runGenerate(["--repo", repoDir, "--out", wikiDir, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.slug, "testrepo");
  assert.equal(summary.backend, "stub");
  assert.equal(summary.status, "stub");
  assert.match(summary.fingerprint, /^[0-9a-f]{16}$/);

  const manifest = readJson(wikiDir, "manifest.json");
  assert.equal(manifest.schemaVersion, "1.0");
  assert.equal(manifest.slug, "testrepo");
  assert.equal(manifest.source.kind, "local");
  assert.equal(manifest.source.fingerprint, summary.fingerprint);
  assert.equal(manifest.counts.pages, manifest.pages.length);
  assert.ok(manifest.pages.length >= 3, "stub wiki should have >= 3 pages for this fixture");
  assert.ok(existsSync(path.join(wikiDir, "index.md")));
  for (const page of manifest.pages) {
    assert.ok(existsSync(path.join(wikiDir, page.path)), `missing ${page.path}`);
    const meta = readJson(wikiDir, page.meta);
    assert.equal(meta.slug, page.slug);
    assert.ok(Array.isArray(meta.citations) && meta.citations.length >= 1);
  }

  // _citations.json: bySource/byPage reverse lookup is mutually consistent.
  const citations = readJson(wikiDir, "_citations.json");
  assert.equal(citations.schemaVersion, "1.0");
  assert.ok(Object.keys(citations.bySource).length > 0);
  for (const [source, slugs] of Object.entries(citations.bySource)) {
    for (const slug of slugs) {
      assert.ok(citations.byPage[slug].some((c) => c.path === source));
    }
  }

  // ── the parity gate: the regen hook reads the fresh wiki as "fresh" ──
  result = runRegen(["status", "testrepo", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  let status = JSON.parse(result.stdout);
  assert.equal(status.freshness, "fresh", `expected fresh, got: ${status.reason}`);
  assert.equal(status.fingerprint.manifest, status.fingerprint.live);

  // ── refuses to overwrite without --force ──
  result = runGenerate(["--repo", repoDir, "--out", wikiDir]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--force/);

  // ── regen round-trip: source change => stale => regenerate via this CLI ──
  writeFileSync(path.join(repoDir, "src", "extra.ts"), "export const extra = 3;\n");
  status = JSON.parse(runRegen(["status", "testrepo", "--json"]).stdout);
  assert.equal(status.freshness, "stale");

  const generatorTemplate = `${JSON.stringify(process.execPath)} --experimental-strip-types scripts/covenwiki-generate.ts generate --repo {repo} --out {out}`;
  result = runRegen(["regenerate", "testrepo", "--json", "--generator", generatorTemplate]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(tailJson(result.stdout).action, "regenerated");
  status = JSON.parse(runRegen(["status", "testrepo", "--json"]).stdout);
  assert.equal(status.freshness, "fresh", `round-trip should end fresh, got: ${status.reason}`);
  assert.ok(readJson(wikiDir, "manifest.json").pages.some((p) => p.slug === "source-layout"));

  // ── cli backend: fake model drives outline + page skills ──
  const cliWikiDir = path.join(wikisDir, "testrepo-cli");
  const modelCmd = `${JSON.stringify(process.execPath)} ${JSON.stringify(fakeModelScript)}`;
  result = runGenerate(
    ["--repo", repoDir, "--out", cliWikiDir, "--backend", "cli", "--model-cmd", modelCmd, "--json"],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "complete");
  const cliManifest = readJson(cliWikiDir, "manifest.json");
  assert.equal(cliManifest.generation.backend, "cli");
  assert.equal(cliManifest.generation.status, "complete");
  assert.deepEqual(
    cliManifest.pages.map((p) => p.slug),
    ["overview", "source-layout", "documentation-guide"],
  );
  assert.match(readFileSync(path.join(cliWikiDir, "pages", "overview.md"), "utf8"), /Fake-model prose/);
  const overviewMeta = readJson(cliWikiDir, "pages", "overview.meta.json");
  assert.equal(overviewMeta.citations[0].startLine, 1);

  // env-var backend selection matches the handoff doc invocation.
  const envWikiDir = path.join(wikisDir, "testrepo-env");
  result = runGenerate(["--repo", repoDir, "--out", envWikiDir], { COVENWIKI_MODEL_BACKEND: "stub" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(envWikiDir, "manifest.json").generation.backend, "stub");

  // ── fail-closed: rule-violating model output writes nothing ──
  const badWikiDir = path.join(wikisDir, "testrepo-bad");
  result = runGenerate(
    ["--repo", repoDir, "--out", badWikiDir, "--backend", "cli", "--model-cmd", modelCmd],
    { FAKE_MODEL_MODE: "bad-outline" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outline failed validation/);
  assert.match(result.stderr, /folder-of-one|not in the file inventory/);
  assert.ok(!existsSync(badWikiDir), "failed run must not leave a wiki behind");
  assert.deepEqual(
    readdirSync(wikisDir).filter((name) => name.includes("testrepo-bad")),
    [],
    "failed run must not leave staging dirs behind",
  );

  console.log("covenwiki-generate CLI e2e: all assertions passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
