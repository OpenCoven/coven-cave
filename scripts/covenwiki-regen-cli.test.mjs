// End-to-end coverage for the plan-semantics wiki commands (S1–S4) of
// scripts/covenwiki-regen.ts — status freshness reporting, regenerate no-op on
// fresh, the fail-closed validate-then-swap, the non-local refusal — plus the
// incremental stages' citations reverse-lookup mode (--citations).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(path.join(tmpdir(), "covenwiki-regen-cli-"));
const repoDir = path.join(dir, "repo");
const wikisDir = path.join(dir, "wikis");
const wikiDir = path.join(wikisDir, "testrepo");
const genScript = path.join(dir, "gen.mjs");

function writeRepo() {
  mkdirSync(path.join(repoDir, "src"), { recursive: true });
  writeFileSync(path.join(repoDir, "README.md"), "# testrepo\n");
  writeFileSync(path.join(repoDir, "src", "main.ts"), "export const x = 1;\n");
}

function manifestFor(slug, fingerprint, marker) {
  return {
    schemaVersion: "1.0",
    slug,
    title: `Wiki ${marker}`,
    source: { kind: "local", repoRoot: repoDir, revision: null, fingerprint, fileCount: 2 },
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
  };
}

function writeWiki(target, { fingerprint, marker, kind = "local" }) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.join(target, "pages"), { recursive: true });
  const manifest = manifestFor(path.basename(target), fingerprint, marker);
  manifest.source.kind = kind;
  writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(target, "pages", "overview.md"), `# Overview (${marker})\n`);
  writeFileSync(
    path.join(target, "pages", "overview.meta.json"),
    JSON.stringify({ slug: "overview", title: "Overview", citations: [], coverageNotes: [], relatedPages: [] }),
  );
}

// Generator fixture: mode comes from GEN_MODE (ok | invalid | fail).
writeFileSync(
  genScript,
  `import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const [out, slug] = process.argv.slice(2);
const mode = process.env.GEN_MODE ?? "ok";
if (mode === "fail") process.exit(3);
mkdirSync(path.join(out, "pages"), { recursive: true });
const manifest = ${JSON.stringify(manifestFor("SLUG", "ffffffffffffffff", "regenerated"))};
manifest.slug = slug;
manifest.source.repoRoot = ${JSON.stringify(repoDir)};
if (mode === "invalid") delete manifest.pages;
writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
if (mode !== "missing-page") {
  writeFileSync(path.join(out, "pages", "overview.md"), "# Overview (regenerated)\\n");
  writeFileSync(path.join(out, "pages", "overview.meta.json"), "{}");
}
`,
);

const GENERATOR = `node "${genScript}" "{out}" {slug}`;

function run(args, env = {}) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/covenwiki-regen.ts", ...args, "--wikis-dir", wikisDir],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, ...env } },
  );
}

function statusJson() {
  const result = run(["status", "testrepo", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

try {
  writeRepo();

  // status: wrong fingerprint => stale, and both fingerprints are reported.
  writeWiki(wikiDir, { fingerprint: "0000000000000000", marker: "v1" });
  let status = statusJson();
  assert.equal(status.freshness, "stale");
  assert.equal(status.fingerprint.manifest, "0000000000000000");
  assert.match(status.fingerprint.live, /^[0-9a-f]{16}$/);
  assert.equal(status.fileCount.live, 2);
  const liveFingerprint = status.fingerprint.live;

  // status: matching fingerprint => fresh.
  writeWiki(wikiDir, { fingerprint: liveFingerprint, marker: "v1" });
  status = statusJson();
  assert.equal(status.freshness, "fresh");

  // status: missing fingerprint => unknown.
  writeWiki(wikiDir, { fingerprint: null, marker: "v1" });
  assert.equal(statusJson().freshness, "unknown");

  // regenerate: fresh wiki is a no-op with exit 0.
  writeWiki(wikiDir, { fingerprint: liveFingerprint, marker: "v1" });
  let result = run(["regenerate", "testrepo", "--json", "--generator", GENERATOR]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).action, "none");
  assert.match(readFileSync(path.join(wikiDir, "pages", "overview.md"), "utf8"), /v1/);

  // regenerate: stale wiki runs the generator and swaps atomically.
  writeFileSync(path.join(repoDir, "src", "main.ts"), "export const x = 2;\n");
  result = run(["regenerate", "testrepo", "--json", "--generator", GENERATOR]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).action, "regenerated");
  assert.match(readFileSync(path.join(wikiDir, "pages", "overview.md"), "utf8"), /regenerated/);
  assert.ok(!existsSync(`${wikiDir}.tmp`), "tmp dir should be gone after the swap");

  // regenerate --force works even when fresh.
  writeWiki(wikiDir, { fingerprint: statusJson().fingerprint.live, marker: "v2" });
  result = run(["regenerate", "testrepo", "--force", "--json", "--generator", GENERATOR]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).action, "regenerated");

  // fail-closed: generator emitting an invalid manifest leaves the live wiki untouched.
  writeWiki(wikiDir, { fingerprint: "0000000000000000", marker: "v3" });
  result = run(["regenerate", "testrepo", "--generator", GENERATOR], { GEN_MODE: "invalid" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /validation/);
  assert.match(readFileSync(path.join(wikiDir, "pages", "overview.md"), "utf8"), /v3/);

  // fail-closed: generator omitting a listed page file is rejected too.
  result = run(["regenerate", "testrepo", "--generator", GENERATOR], { GEN_MODE: "missing-page" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing pages\/overview/);
  assert.match(readFileSync(path.join(wikiDir, "pages", "overview.md"), "utf8"), /v3/);

  // fail-closed: generator exiting nonzero keeps the live wiki and forwards failure.
  result = run(["regenerate", "testrepo", "--generator", GENERATOR], { GEN_MODE: "fail" });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /live wiki untouched/);
  assert.match(readFileSync(path.join(wikiDir, "pages", "overview.md"), "utf8"), /v3/);

  // dry run: reports the command without touching anything.
  result = run(["regenerate", "testrepo", "--dry-run", "--json", "--generator", GENERATOR]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).action, "would-regenerate");
  assert.match(readFileSync(path.join(wikiDir, "pages", "overview.md"), "utf8"), /v3/);

  // non-local sources are unknown and never auto-regenerate.
  writeWiki(wikiDir, { fingerprint: "0000000000000000", marker: "gh", kind: "github" });
  assert.equal(statusJson().freshness, "unknown");
  result = run(["regenerate", "testrepo", "--generator", GENERATOR]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to regenerate/);
  result = run(["regenerate", "testrepo", "--force", "--generator", GENERATOR]);
  assert.equal(result.status, 1, "github kind must refuse even with --force");

  // guardrails: unknown wiki and path-shaped slugs error cleanly.
  result = run(["status", "missing-wiki"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /wiki not found/);
  result = run(["status", "../escape"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid slug/);

  // ── incremental stages: citations reverse-lookup mode (--citations) ──
  // An outline-driven source repo: pages do NOT mirror file paths, and a
  // non-markdown source (src/util.ts) is cited by a page — both impossible
  // to plan correctly under path-stemming.
  const stagesRepo = path.join(dir, "stages-repo");
  mkdirSync(path.join(stagesRepo, "docs"), { recursive: true });
  mkdirSync(path.join(stagesRepo, "src"), { recursive: true });
  writeFileSync(path.join(stagesRepo, "docs", "a.md"), "alpha v1\n");
  writeFileSync(path.join(stagesRepo, "src", "util.ts"), "export const u = 1;\n");
  const citationsFile = path.join(stagesRepo, "_citations.json");
  writeFileSync(
    citationsFile,
    JSON.stringify({
      schemaVersion: "1.0",
      generatedAt: "2026-07-14T00:00:00.000Z",
      bySource: { "docs/a.md": ["getting-started", "overview"], "src/util.ts": ["api-surface"] },
      byPage: {},
    }),
  );
  const scriptPath = path.join(fileURLToPath(new URL("..", import.meta.url)), "scripts", "covenwiki-regen.ts");
  const stageArgs = ["--source", "docs", "--source", "src", "--state", ".cw/state.json"];
  const runStages = (args) =>
    spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, ...args, ...stageArgs], {
      cwd: stagesRepo,
      encoding: "utf8",
    });

  // Baseline state, then edit one cited markdown source.
  result = runStages(["run"]);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(path.join(stagesRepo, "docs", "a.md"), "alpha v2\n");

  // With --citations: actions target the citing outline slugs, not the "a" stem.
  result = runStages(["plan", "--citations", citationsFile, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  let planOut = JSON.parse(result.stdout).plan;
  assert.deepEqual(
    planOut.actions.map((a) => [a.kind, a.page]),
    [
      ["regenerate-page", "getting-started"],
      ["regenerate-page", "overview"],
      ["rebuild-index", null],
    ],
  );

  // Without --citations the legacy stemming still maps docs/a.md -> "a".
  result = runStages(["plan", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  planOut = JSON.parse(result.stdout).plan;
  assert.deepEqual(
    planOut.actions.map((a) => [a.kind, a.page]),
    [
      ["regenerate-page", "a"],
      ["rebuild-index", null],
    ],
  );

  // Cited non-markdown source maps to its page; removed source regenerates
  // (never remove-page) — the two semantic fixes over stemming.
  result = runStages(["run"]);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(path.join(stagesRepo, "src", "util.ts"), "export const u = 2;\n");
  rmSync(path.join(stagesRepo, "docs", "a.md"));
  result = runStages(["plan", "--citations", citationsFile, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  planOut = JSON.parse(result.stdout).plan;
  assert.deepEqual(
    planOut.actions.map((a) => [a.kind, a.page, a.reason]),
    [
      ["regenerate-page", "api-surface", "changed"],
      ["regenerate-page", "getting-started", "source removed"],
      ["regenerate-page", "overview", "source removed"],
      ["rebuild-index", null, "cited sources changed"],
    ],
  );

  // Fail-closed: a malformed citations file aborts instead of degrading to stemming.
  writeFileSync(citationsFile, JSON.stringify({ schemaVersion: "2.0", bySource: {} }));
  result = runStages(["plan", "--citations", citationsFile]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /schemaVersion/);
  result = runStages(["plan", "--citations", path.join(stagesRepo, "nope.json")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /citations file not found/);

  console.log("covenwiki-regen CLI: all assertions passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
