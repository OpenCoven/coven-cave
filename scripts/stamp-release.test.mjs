// @ts-nocheck
// cave-ef6f — stamp-release script + partial updater manifest resilience.
// Pure tests exercise the exported stamp helpers; source pins hold the
// release.yml resilience and the verify script's --allow-partial contract.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bumpVersion,
  STAMP_FILES,
  stampContent,
  buildChangelogSection,
  insertChangelogSection,
  findOpenStampPr,
} from "./stamp-release.mjs";
import { applyReplacement } from "./release-yaml-settings.mjs";

// ── bumpVersion ───────────────────────────────────────────────────────────────
assert.equal(bumpVersion("0.0.159"), "0.0.160");
assert.equal(bumpVersion("0.0.159", "minor"), "0.1.0");
assert.equal(bumpVersion("0.4.9", "major"), "1.0.0");
assert.throws(() => bumpVersion("garbage"), /unparseable/);
assert.throws(() => bumpVersion("1.2.3", "mega"), /unknown bump level/);

// ── stampContent: each kind scoped so nothing unrelated rewrites ──────────────
{
  const { content, replaced } = stampContent(
    "json-version",
    `{\n  "name": "coven-cave",\n  "version": "0.0.159",\n  "dep": { "version": "0.0.159" }\n}`,
    "0.0.159",
    "0.0.160",
  );
  assert.equal(replaced, 1, "json stamps only the first version field");
  assert.match(content, /"version": "0\.0\.160"/);
  assert.match(content, /"dep": \{ "version": "0\.0\.159" \}/, "nested same-version field untouched");
}
{
  const lock = `[[package]]\nname = "aho-corasick"\nversion = "0.0.159"\n\n[[package]]\nname = "app"\nversion = "0.0.159"\n`;
  const { content, replaced } = stampContent("cargo-lock-app", lock, "0.0.159", "0.0.160");
  assert.equal(replaced, 1, "only the app package block is stamped");
  assert.match(content, /name = "aho-corasick"\nversion = "0\.0\.159"/, "same-version dependency untouched");
  assert.match(content, /name = "app"\nversion = "0\.0\.160"/);
}
{
  const { replaced } = stampContent("toml-version", `[package]\nname = "app"\nversion = "0.0.159"\n`, "0.0.159", "0.0.160");
  assert.equal(replaced, 1);
}
assert.equal(STAMP_FILES.length, 4, "exactly the four stamp locations");
assert.throws(() => stampContent("nope", "", "a", "b"), /unknown stamp kind/);

// ── changelog ─────────────────────────────────────────────────────────────────
{
  const section = buildChangelogSection({
    version: "0.0.160",
    prevVersion: "0.0.159",
    dateIso: "2026-07-09",
    subjects: ["feat(a): thing (#1)", "chore(release): stamp v0.0.159 (#2797)", "fix(b): other (#2)"],
  });
  assert.match(section, /^## \[0\.0\.160\] - 2026-07-09/, "keep-a-changelog heading");
  assert.match(section, /- feat\(a\): thing \(#1\)/);
  assert.doesNotMatch(section, /stamp v0\.0\.159/, "prior stamp commits filtered from the draft");
  const inserted = insertChangelogSection("# Changelog\n\n## [Unreleased]\n\n## [0.0.159] - 2026-07-08\n", section);
  assert.ok(
    inserted.indexOf("## [Unreleased]") < inserted.indexOf("## [0.0.160]") &&
      inserted.indexOf("## [0.0.160]") < inserted.indexOf("## [0.0.159]"),
    "new section lands between Unreleased and the previous release",
  );
  assert.throws(() => insertChangelogSection("# no anchor here", section), /no "## \[Unreleased\]" anchor/);
}

// ── collision guard ───────────────────────────────────────────────────────────
assert.equal(findOpenStampPr([{ title: "feat: x" }]), null);
assert.equal(findOpenStampPr([{ title: "feat: x" }, { title: "chore(release): stamp v0.0.160", number: 9 }]).number, 9);

// ── YAML release settings canonical-path guard ───────────────────────────────
for (const [label, source] of [
  [
    "literal block",
    `settings:\n  base:\n    MARKETING_VERSION: |\n      0.2.1\n`,
  ],
  [
    "folded block",
    `settings:\n  base:\n    MARKETING_VERSION: >\n      0.2.1\n`,
  ],
]) {
  assert.throws(
    () => applyReplacement("yaml-marketing-version", source, "0.2.2", "apps/ios/CovenCave/project.yml"),
    (err) => {
      const message = String(err?.message ?? err);
      assert.match(message, /apps\/ios\/CovenCave\/project\.yml/);
      assert.match(message, /settings\.base\.MARKETING_VERSION/);
      assert.match(message, /single-line|plain or quoted/i);
      assert.doesNotMatch(message, /Unsupported default string type/);
      return true;
    },
    `${label} MARKETING_VERSION should be rejected with an actionable source label`,
  );
}

// ── release.yml resilience pins ───────────────────────────────────────────────
const yml = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

function workflowJob(source, jobName) {
  const marker = `\n  ${jobName}:\n`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${jobName} job must exist`);
  const startIndex = markerIndex + 1;
  const nextJob = /\n  [A-Za-z0-9_-]+:\n/g;
  nextJob.lastIndex = markerIndex + marker.length;
  const nextMatch = nextJob.exec(source);
  return source.slice(startIndex, nextMatch?.index ?? source.length);
}

assert.match(yml, /daemon-package:\s*\n\s+name: Verify matching Coven daemon package/, "release has a daemon package gate");
assert.match(yml, /npm view "@opencoven\/cli@latest" version/, "daemon gate verifies the package installed by the client");
assert.match(yml, /process\.argv\[2\], process\.argv\[3\]\) >= 0/, "daemon gate requires latest CLI to satisfy the Cave version");
assert.match(yml, /build:[\s\S]{0,100}needs: daemon-package/, "desktop builds wait for the daemon package gate");
const updaterManifestJob = workflowJob(yml, "updater-manifest");
const updaterManifestCondition = /^    if: (.+)$/m.exec(updaterManifestJob)?.[1];
assert.ok(updaterManifestCondition, "updater-manifest must have a job-level condition");
assert.match(updaterManifestCondition, /!cancelled\(\)/, "updater-manifest does not run after cancellation");
assert.match(
  updaterManifestCondition,
  /needs\.build\.result != 'cancelled'/,
  "updater-manifest rejects a cancelled build",
);
assert.match(
  updaterManifestCondition,
  /needs\.build\.result != 'skipped'/,
  "updater-manifest rejects a build that was skipped entirely",
);
assert.doesNotMatch(
  updaterManifestCondition,
  /success\(\)/,
  "updater-manifest still runs after a partial build failure",
);
assert.match(yml, /PLATFORM_COUNT=\$count.*GITHUB_ENV/, "platform count exported for the body note");
assert.match(yml, /Flag partial updater coverage in the release body/, "partial coverage is flagged on the release itself");
assert.match(yml, /sed '\/Partial updater coverage\/d'/, "the body note is idempotent (marker stripped before deciding)");
assert.match(yml, /latest\.json has 0 platforms/, "zero platforms stays fatal");

// ── verify-release-updater --allow-partial pins ───────────────────────────────
const verify = await readFile(new URL("./verify-release-updater.mjs", import.meta.url), "utf8");
assert.match(verify, /allowPartial = process\.argv\.includes\("--allow-partial"\)/, "flag exists");
assert.match(
  verify,
  /\(allowPartial \? warn : fail\)\(`missing platform/,
  "missing platform downgrades to a warning under --allow-partial",
);
assert.match(
  verify,
  /if \(!Object\.keys\(plats\)\.length\) fail\(/,
  "an EMPTY manifest fails even with --allow-partial",
);

console.log("stamp-release.test.mjs: ok");
