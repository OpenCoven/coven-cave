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
  const plist = `<key>CFBundleShortVersionString</key>\n\t<string>0.0.159</string>\n<key>CFBundleVersion</key>\n\t<string>0.0.159</string>\n<key>Other</key>\n\t<string>1.0</string>`;
  const { content, replaced } = stampContent("plist-string", plist, "0.0.159", "0.0.160");
  assert.equal(replaced, 2, "both plist version strings stamp");
  assert.doesNotMatch(content, /0\.0\.159/);
  assert.match(content, /<string>1\.0<\/string>/, "unrelated strings untouched");
}
{
  const { replaced } = stampContent("toml-version", `[package]\nname = "app"\nversion = "0.0.159"\n`, "0.0.159", "0.0.160");
  assert.equal(replaced, 1);
}
assert.equal(STAMP_FILES.length, 6, "exactly the six stamp locations");
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

// ── release.yml resilience pins ───────────────────────────────────────────────
const yml = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
assert.match(
  yml,
  /updater-manifest:[\s\S]{0,900}if: \$\{\{ !cancelled\(\) && needs\.build\.result != 'cancelled' \}\}/,
  "updater-manifest runs even when a build leg failed (a flake must not 404 the updater)",
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
